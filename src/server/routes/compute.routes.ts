import { Hono } from "hono";
import type { Env, EvaluationRound, Submission } from "../types";
import {
  completeTask,
  createTaskLease,
  dequeueTask,
  formatEvaluationHistoryPrompt,
  getAssignments,
  getSubmission,
  recoverOrphanedTasks,
  saveSubmission
} from "../kv";
import { safeCompare } from "../auth";

export const computeRoutes = new Hono<{ Bindings: Env }>();

/** 计算层安全鉴权中间件 */
computeRoutes.use("*", async (c, next) => {
  const customHeader = c.req.header("X-Compute-Token");
  const authHeader = c.req.header("Authorization");
  const token =
    customHeader || (authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null);

  if (!token || !safeCompare(token, c.env.COMPUTE_AUTH_TOKEN)) {
    return c.json({ success: false, error: "计算层鉴权失败：无效的通信令牌" }, 401);
  }

  await next();
});

/** 1. 任务拉取 (自动孤儿任务对账与独占租约) */
computeRoutes.get("/task", async c => {
  await recoverOrphanedTasks(c.env.CPHW_KV);

  const clientWorkerId = c.req.header("X-Worker-Id") || undefined;
  const task = await dequeueTask(c.env.CPHW_KV, clientWorkerId);

  if (!task) {
    return c.json({
      success: true,
      hasTask: false,
      message: "当前暂无待评测作业"
    });
  }

  const nowStr = new Date().toISOString();

  // 更新作业提交状态为评测中
  const existingSub = await getSubmission(c.env.CPHW_KV, task.assignmentId, task.studentId);
  if (existingSub && existingSub.activeTaskId === task.taskId) {
    existingSub.status = "in_progress";
    existingSub.startedAt = nowStr;
    existingSub.details = "计算层已认领任务，正在沙箱中编译并执行测试用例...";
    await saveSubmission(c.env.CPHW_KV, existingSub);
    await createTaskLease(c.env.CPHW_KV, task);
  }

  // 同步最新作业元数据
  let title = task.assignmentTitle || "";
  let overview = task.assignmentOverview || "";
  let details = task.assignmentDetails || "";

  try {
    const assignments = await getAssignments(c.env.CPHW_KV);
    const assignment = assignments.find(a => a.id === task.assignmentId);
    if (assignment) {
      if (assignment.title) title = assignment.title;
      if (assignment.overview) overview = assignment.overview;
      if (assignment.details) details = assignment.details;
    }
  } catch {}

  // 评价轮次与迭代提示词
  const currentRound = task.currentRound || 1;
  const chineseNumbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const roundStr =
    currentRound <= 10 && currentRound >= 1 ? `第${chineseNumbers[currentRound]}次` : `第 ${currentRound} 次`;
  const currentRoundLabel = task.currentRoundLabel || `${roundStr}评测`;
  const history = task.history || [];
  const historyPrompt = task.historyPrompt || formatEvaluationHistoryPrompt(currentRound, history);

  console.log(
    `[Compute Pull] Dispatched task ${task.taskId} (student: ${task.studentId}, assignment: ${task.assignmentId}, ${currentRoundLabel})`
  );

  return c.json({
    success: true,
    hasTask: true,
    task: {
      taskId: task.taskId,
      studentId: task.studentId,
      assignmentId: task.assignmentId,
      assignmentTitle: title,
      assignmentOverview: overview,
      assignmentDetails: details,
      title,
      overview,
      details,
      currentRound,
      currentRoundLabel,
      history,
      historyPrompt,
      repoUrl: task.repoUrl,
      branch: task.branch,
      subpath: task.subpath,
      submittedAt: task.submittedAt
    }
  });
});

/** 2. 批改结果回传 (支持幂等重试) */
computeRoutes.post("/report", async c => {
  const { taskId, studentId, assignmentId, score, details } = await c.req.json<{
    taskId?: string;
    studentId?: string;
    assignmentId?: string;
    score?: number;
    details?: string;
  }>();

  if (!taskId || !studentId || !assignmentId || score === undefined) {
    return c.json({ success: false, error: "缺少必要的回传字段 (taskId, studentId, assignmentId, score)" }, 400);
  }

  // 字段合法格式正则校验
  if (!/^\d{13}$/.test(studentId.trim()) || !/^[a-zA-Z0-9_-]{1,32}$/.test(assignmentId.trim())) {
    return c.json({ success: false, error: "回传字段格式不合法 (学号或作业编号异常)" }, 400);
  }

  // 分数边界校验 (0 ~ 100)
  const numScore = Number(score);
  if (isNaN(numScore) || numScore < 0 || numScore > 100) {
    return c.json({ success: false, error: "分数必须为 0 到 100 之间的合法数值" }, 400);
  }
  const roundedScore = Math.round(numScore * 10) / 10;

  const existingSub = await getSubmission(c.env.CPHW_KV, assignmentId, studentId);
  if (!existingSub) {
    return c.json({ success: false, error: "未找到对应的提交记录" }, 404);
  }

  // 幂等性重试分支：如果是同一完结任务因网络重试再次发送相同的报告
  const isAlreadyCompletedTask = existingSub.status === "graded" && existingSub.lastTaskId === taskId;
  if (isAlreadyCompletedTask) {
    if (existingSub.score === roundedScore) {
      console.log(`[Compute Report Idempotent] Task ${taskId} already processed. Returning 200 OK.`);
      await completeTask(c.env.CPHW_KV, taskId);
      return c.json({
        success: true,
        message: "评测结果已写入（网络重试幂等成功）",
        submission: existingSub,
        idempotent: true
      });
    } else {
      return c.json({ success: false, error: "已完结的任务不可重复覆写不同成绩（防重放篡改）" }, 409);
    }
  }

  // 任务 ID 匹配性与重放校验：必须处于活跃中且 activeTaskId 与回传 taskId 吻合
  if (existingSub.activeTaskId !== taskId) {
    return c.json(
      {
        success: false,
        error: "未找到匹配的待评测任务，或任务已被更新版本覆盖 (防重放与跨任务覆盖)"
      },
      409
    );
  }

  // ANSI 控制字符过滤与日志截断防护 (最多 32KB)
  const rawDetails = typeof details === "string" ? details : "评测完成";
  const sanitizedDetails = rawDetails
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "")
    .slice(0, 32768);
  const nowStr = new Date().toISOString();

  // 维护评价轮次归档档案
  const currentRound = existingSub.currentRound || (existingSub.history?.length ? existingSub.history.length + 1 : 1);
  const chineseNumbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const roundStr =
    currentRound <= 10 && currentRound >= 1 ? `第${chineseNumbers[currentRound]}次` : `第 ${currentRound} 次`;
  const currentRoundLabel = existingSub.currentRoundLabel || `${roundStr}评测`;

  const thisRoundRecord: EvaluationRound = {
    round: currentRound,
    roundLabel: currentRoundLabel,
    taskId,
    score: roundedScore,
    details: sanitizedDetails,
    repoUrl: existingSub.repoUrl || "",
    branch: existingSub.branch,
    subpath: existingSub.subpath,
    submittedAt: existingSub.submittedAt || nowStr,
    gradedAt: nowStr
  };

  const history: EvaluationRound[] = existingSub.history ? [...existingSub.history] : [];
  const existingIndex = history.findIndex(h => h.taskId === taskId);
  if (existingIndex >= 0) {
    history[existingIndex] = thisRoundRecord;
  } else {
    history.push(thisRoundRecord);
  }

  const updatedSub: Submission = {
    id: existingSub.id || `sub-${assignmentId}-${studentId}`,
    assignmentId,
    studentId,
    activeTaskId: undefined, // 评测结束，清空活跃任务锁
    lastTaskId: taskId,      // 记录最近完成的任务 ID，赋能幂等校验
    repoUrl: existingSub.repoUrl || "",
    branch: existingSub.branch,
    subpath: existingSub.subpath,
    status: "graded",
    score: roundedScore,
    details: sanitizedDetails,
    submittedAt: existingSub.submittedAt || nowStr,
    startedAt: existingSub.startedAt,
    gradedAt: nowStr,
    currentRound,
    currentRoundLabel,
    history
  };

  // 1. 原子写回成绩与元数据
  await saveSubmission(c.env.CPHW_KV, updatedSub);

  // 2. 清理已完成任务与租约
  await completeTask(c.env.CPHW_KV, taskId);

  console.log(
    `[Compute Report] Graded student ${studentId} assignment ${assignmentId}: Task ${taskId}, Score ${roundedScore}`
  );

  return c.json({
    success: true,
    message: "成绩与评测详情已成功写回",
    submission: updatedSub
  });
});

