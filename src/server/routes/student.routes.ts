import { Hono } from "hono";
import type { Env, EvaluationRound, QueueTask, Submission } from "../types";
import { verifyAuthToken } from "../auth";
import {
  enqueueTask,
  formatEvaluationHistoryPrompt,
  getAssignments,
  getRepoWhitelistPrefixes,
  getSubmission,
  hasActiveTask,
  isUserTokenValid,
  parseAndValidateRepoUrl,
  saveSubmission
} from "../kv";

export const studentRoutes = new Hono<{ Bindings: Env }>();

/** 中间件：校验登录状态与 tokenVersion */
studentRoutes.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "请先登录" }, 401);
  }

  const token = authHeader.substring(7);
  const payload = await verifyAuthToken(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ success: false, error: "登录凭证已失效，请重新登录" }, 401);
  }

  // 校验角色权限
  if (payload.role !== "student") {
    return c.json({ success: false, error: "权限不足：仅限学生身份访问此接口" }, 403);
  }

  // 校验 Token 版本号
  const isTokenValid = await isUserTokenValid(c.env.CPHW_KV, payload.username, payload.tokenVersion);
  if (!isTokenValid) {
    return c.json({ success: false, error: "登录凭证已失效（密码已被重置），请重新登录" }, 401);
  }

  c.set("user" as any, payload);
  await next();
});

/** 获取作业列表与提交状态 */
studentRoutes.get("/assignments", async c => {
  const user = c.get("user" as any) as { username: string; role: string };
  const studentId = user.username;

  const assignments = await getAssignments(c.env.CPHW_KV);
  const allowedPrefixes = await getRepoWhitelistPrefixes(c.env.CPHW_KV);

  const result = await Promise.all(
    assignments.map(async item => {
      const submission = await getSubmission(c.env.CPHW_KV, item.id, studentId);
      return {
        ...item,
        submission: submission || {
          status: "not_submitted",
          repoUrl: "",
          score: null,
          details: null,
          submittedAt: null,
          gradedAt: null
        }
      };
    })
  );

  return c.json({
    success: true,
    allowedPrefixes,
    assignments: result
  });
});

/** 提交作业并入队评测任务 */
studentRoutes.post("/submit", async c => {
  const user = c.get("user" as any) as { username: string; role: string };
  const studentId = user.username;

  const { assignmentId, repoUrl, branch, subpath } = await c.req.json<{
    assignmentId?: string;
    repoUrl?: string;
    branch?: string;
    subpath?: string;
  }>();

  if (!assignmentId || !repoUrl) {
    return c.json({ success: false, error: "缺少作业编号或仓库地址" }, 400);
  }

  // 校验作业 ID 格式
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(assignmentId)) {
    return c.json({ success: false, error: "非法的作业编号格式" }, 400);
  }

  // 校验并规范化 Git 仓库地址
  const parseResult = await parseAndValidateRepoUrl(c.env.CPHW_KV, repoUrl, branch, subpath);
  if (!parseResult.valid) {
    return c.json({ success: false, error: parseResult.reason || "仓库地址不合规" }, 400);
  }

  const cleanRepoUrl = parseResult.cleanRepoUrl!;
  const cleanBranch = parseResult.parsedBranch;
  const cleanSubpath = parseResult.parsedSubpath;

  // 任务排队互斥检测
  const isBusy = await hasActiveTask(c.env.CPHW_KV, assignmentId, studentId);
  if (isBusy) {
    return c.json(
      {
        success: false,
        error: "您提交的上一版本作业评测任务正在排队或评测中，请等待批改结果生成后再提交更新！"
      },
      409
    );
  }

  // 校验作业是否存在
  const assignments = await getAssignments(c.env.CPHW_KV);
  const assignment = assignments.find(a => a.id === assignmentId);
  if (!assignment) {
    return c.json({ success: false, error: "未找到对应的作业" }, 404);
  }

  // 提取历史评价轮次
  const existingSub = await getSubmission(c.env.CPHW_KV, assignmentId, studentId);
  let history: EvaluationRound[] = [];
  if (existingSub) {
    if (existingSub.history && existingSub.history.length > 0) {
      history = [...existingSub.history];
    } else if (existingSub.status === "graded" && existingSub.score !== null) {
      history = [
        {
          round: 1,
          roundLabel: "第一次评测",
          taskId: existingSub.lastTaskId || existingSub.activeTaskId || "legacy-task-1",
          score: existingSub.score,
          details: existingSub.details,
          repoUrl: existingSub.repoUrl,
          branch: existingSub.branch,
          subpath: existingSub.subpath,
          submittedAt: existingSub.submittedAt,
          gradedAt: existingSub.gradedAt
        }
      ];
    }
  }

  const currentRound = history.length + 1;
  const chineseNumbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const roundStr = currentRound <= 10 && currentRound >= 1 ? `第${chineseNumbers[currentRound]}次` : `第 ${currentRound} 次`;
  const currentRoundLabel = `${roundStr}评测`;
  const historyPrompt = formatEvaluationHistoryPrompt(currentRound, history);

  const nowStr = new Date().toISOString();
  const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const submission: Submission = {
    id: `sub-${assignmentId}-${studentId}`,
    assignmentId,
    studentId,
    activeTaskId: taskId, // 绑定活跃任务 ID
    repoUrl: cleanRepoUrl,
    branch: cleanBranch,
    subpath: cleanSubpath,
    status: "queued",
    score: null,
    details: `已提交（${roundStr}），正在等待计算层拉取评测...`,
    submittedAt: nowStr,
    gradedAt: null,
    currentRound,
    currentRoundLabel,
    history
  };
  await saveSubmission(c.env.CPHW_KV, submission);

  const queueTask: QueueTask = {
    taskId,
    studentId,
    assignmentId,
    assignmentTitle: assignment.title,
    assignmentOverview: assignment.overview,
    assignmentDetails: assignment.details,
    repoUrl: cleanRepoUrl,
    branch: cleanBranch,
    subpath: cleanSubpath,
    submittedAt: nowStr,
    retryCount: 0,
    currentRound,
    currentRoundLabel,
    history,
    historyPrompt
  };
  await enqueueTask(c.env.CPHW_KV, queueTask);

  console.log(`[Queue] Dispatched task ${taskId} (${currentRoundLabel}, branch: ${cleanBranch || 'default'}, subpath: ${cleanSubpath || '.'}) for student ${studentId}`);

  return c.json({
    success: true,
    message: "作业已成功提交并推入评测队列！计算层将自动拉取批改。",
    submission
  });
});

