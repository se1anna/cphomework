import { Hono } from "hono";
import type { Assignment, Env, Submission } from "../types";
import { STUDENT_WHITELIST } from "../../config/whitelist";
import { hashPassword, verifyAuthToken, verifyUserPassword } from "../auth";
import {
  appendAdminAuditLog,
  checkIpRateLimit,
  getAdminAuditLogs,
  getAssignments,
  getQueueLength,
  getRegisteredStudentIds,
  getRepoWhitelistPrefixes,
  getSubmissionsForAssignment,
  getSubmittedStudentIdsForAssignment,
  getUser,
  isUserTokenValid,
  saveAssignments,
  setRepoWhitelistPrefixes
} from "../kv";

export const adminRoutes = new Hono<{ Bindings: Env }>();

/** 格式化 CSV 单元格 (转义双引号与特殊前缀) */
export function sanitizeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);

  // 避免公式注入字符
  const trimmed = str.trimStart();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    str = `'${str}`;
  }

  // RFC 4180 转义
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/** 管理员鉴权中间件 */
adminRoutes.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "未授权，请以管理员身份登录" }, 401);
  }

  const token = authHeader.substring(7);
  const payload = await verifyAuthToken(token, c.env.JWT_SECRET);
  if (!payload || payload.role !== "admin") {
    return c.json({ success: false, error: "权限不足，仅管理员可访问" }, 403);
  }

  const isTokenValid = await isUserTokenValid(c.env.CPHW_KV, payload.username, payload.tokenVersion);
  if (!isTokenValid) {
    return c.json({ success: false, error: "登录凭证已失效（管理员密码已重置），请重新登录" }, 401);
  }

  await next();
});

/** 获取管理看板指标 */
adminRoutes.get("/overview", async c => {
  const kv = c.env.CPHW_KV;
  const assignments = await getAssignments(kv);
  const registeredStudents = await getRegisteredStudentIds(kv);
  const queueLength = await getQueueLength(kv);
  const whitelistCount = STUDENT_WHITELIST.length;
  const registeredCount = registeredStudents.length;

  // 检查管理员是否使用初始密码 123456
  const adminUser = await getUser(kv, "admin");
  let isDefaultAdminPassword = false;
  if (adminUser) {
    if (adminUser.isDefaultPassword !== undefined) {
      isDefaultAdminPassword = adminUser.isDefaultPassword;
    } else {
      const outcome = await verifyUserPassword("123456", adminUser);
      isDefaultAdminPassword = outcome.valid;
    }
  }

  const assignmentStats = await Promise.all(
    assignments.map(async a => {
      const subs = await getSubmissionsForAssignment(kv, a.id);
      const submittedCount = subs.length;

      let totalScore = 0;
      let gradedCount = 0;
      for (const sub of subs) {
        if (sub.score !== null) {
          totalScore += sub.score;
          gradedCount++;
        }
      }

      const avgScore = gradedCount > 0 ? (totalScore / gradedCount).toFixed(1) : "-";

      return {
        id: a.id,
        week: a.week,
        title: a.title,
        submittedCount,
        registeredCount,
        whitelistCount,
        completionRateRegistered:
          registeredCount > 0 ? Math.round((submittedCount / registeredCount) * 100) : 0,
        completionRateWhitelist: Math.round((submittedCount / whitelistCount) * 100),
        avgScore
      };
    })
  );

  return c.json({
    success: true,
    isDefaultAdminPassword,
    metrics: {
      whitelistCount,
      registeredCount,
      queueLength,
      assignmentCount: assignments.length
    },
    assignmentStats
  });
});

/** 发布或更新作业 */
adminRoutes.post("/assignments", async c => {
  const clientIp = c.req.header("cf-connecting-ip") || "unknown-ip";
  const limit = await checkIpRateLimit(c.env.CPHW_KV, clientIp, "admin_publish", 15, 60);
  if (!limit.allowed) {
    return c.json({ success: false, error: "发布过于频繁，请稍后再试" }, 429);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ success: false, error: "无效的请求载荷" }, 400);
  }

  const { week, title, overview, details } = body;

  if (typeof title !== "string" || !title.trim()) {
    return c.json({ success: false, error: "作业标题不能为空" }, 400);
  }
  if (typeof overview !== "string" || !overview.trim()) {
    return c.json({ success: false, error: "作业简介不能为空" }, 400);
  }

  const cleanWeek = Math.floor(Number(week));
  if (isNaN(cleanWeek) || cleanWeek < 1 || cleanWeek > 52) {
    return c.json({ success: false, error: "无效的周次数值 (1~52)" }, 400);
  }

  const assignments = await getAssignments(c.env.CPHW_KV);
  const newAssignment: Assignment = {
    id: `hw-${cleanWeek}`,
    week: cleanWeek,
    title: title.trim().slice(0, 100),
    overview: overview.trim().slice(0, 300),
    details: (typeof details === "string" ? details : "").trim().slice(0, 5000),
    createdAt: new Date().toISOString()
  };

  const filtered = assignments.filter(a => a.id !== newAssignment.id);
  filtered.push(newAssignment);
  filtered.sort((a, b) => a.week - b.week);

  await saveAssignments(c.env.CPHW_KV, filtered);

  // 记录审计日志
  await appendAdminAuditLog(c.env.CPHW_KV, {
    operator: "admin",
    action: "publish_assignment",
    target: newAssignment.id,
    details: `发布/更新周次 ${newAssignment.week} 作业: 《${newAssignment.title}》`,
    ip: clientIp
  });

  return c.json({
    success: true,
    message: "作业发布成功",
    assignment: newAssignment
  });
});

/** 删除作业 */
adminRoutes.delete("/assignments/:id", async c => {
  const id = c.req.param("id");
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    return c.json({ success: false, error: "非法的作业编号参数" }, 400);
  }

  const clientIp = c.req.header("cf-connecting-ip") || "unknown-ip";
  const kv = c.env.CPHW_KV;
  const assignments = await getAssignments(kv);
  const target = assignments.find(a => a.id === id);
  const updated = assignments.filter(a => a.id !== id);

  await saveAssignments(kv, updated);

  // 清理作业关联的提交索引
  await kv.delete(`meta:subs_map:${id}`);
  await kv.delete(`meta:subs:${id}`);

  // 记录审计日志
  await appendAdminAuditLog(kv, {
    operator: "admin",
    action: "delete_assignment",
    target: id,
    details: `删除了作业 ${id} (原标题: ${target ? target.title : "未知"}) 及所有关联索引`,
    ip: clientIp
  });

  return c.json({ success: true, message: `作业 ${id} 已成功删除` });
});

/** 查询未提交作业的学生名单 */
adminRoutes.get("/assignments/:id/missing-students", async c => {
  const id = c.req.param("id");
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    return c.json({ success: false, error: "非法的作业编号参数" }, 400);
  }

  const kv = c.env.CPHW_KV;
  const submittedIds = await getSubmittedStudentIdsForAssignment(kv, id);
  const submittedSet = new Set(submittedIds);
  const registeredStudents = await getRegisteredStudentIds(kv);

  const missingFromWhitelist = STUDENT_WHITELIST.filter(sid => !submittedSet.has(sid));
  const missingFromRegistered = registeredStudents.filter(sid => !submittedSet.has(sid));

  return c.json({
    success: true,
    assignmentId: id,
    submittedCount: submittedIds.length,
    missingFromWhitelist,
    missingFromRegistered
  });
});

/** 获取作业的提交列表 */
adminRoutes.get("/assignments/:id/submissions", async c => {
  const id = c.req.param("id");
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    return c.json({ success: false, error: "非法的作业编号参数" }, 400);
  }

  const submissions = await getSubmissionsForAssignment(c.env.CPHW_KV, id);
  return c.json({ success: true, assignmentId: id, submissions });
});

/** 导出作业提交与成绩列表 (CSV) */
adminRoutes.get("/assignments/:id/export-csv", async c => {
  const id = c.req.param("id");
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    return c.json({ success: false, error: "非法的作业编号参数" }, 400);
  }

  const kv = c.env.CPHW_KV;
  const submissions = await getSubmissionsForAssignment(kv, id);

  const headers = ["学号", "提交状态", "得分", "提交时间", "批改时间", "仓库地址", "分支", "子路径", "评测摘要"];
  const rows: string[] = [];
  rows.push(headers.map(sanitizeCsvField).join(","));

  for (const sub of submissions) {
    const row = [
      sub.studentId,
      sub.status === "graded" ? "已批改" : sub.status === "in_progress" ? "评测中" : "排队中",
      sub.score !== null ? sub.score : "未评分",
      sub.submittedAt || "-",
      sub.gradedAt || "-",
      sub.repoUrl || "-",
      sub.branch || "默认",
      sub.subpath || "根目录",
      sub.details ? sub.details.slice(0, 150).replace(/\r?\n/g, " ") : "-"
    ];
    rows.push(row.map(sanitizeCsvField).join(","));
  }

  const csvContent = "\uFEFF" + rows.join("\r\n");

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assignment_${id}_submissions.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    }
  });
});

/** 获取与设置 Git 仓库白名单前缀 */
adminRoutes.get("/config", async c => {
  const prefixes = await getRepoWhitelistPrefixes(c.env.CPHW_KV);
  return c.json({ success: true, prefixes });
});

adminRoutes.post("/config", async c => {
  const { prefixes } = await c.req.json<{ prefixes?: string[] }>();
  if (!prefixes || !Array.isArray(prefixes) || prefixes.length === 0) {
    return c.json({ success: false, error: "前缀列表不能为空" }, 400);
  }

  // 校验前缀格式
  for (const p of prefixes) {
    if (
      typeof p !== "string" ||
      !p.startsWith("https://") ||
      !p.endsWith("/") ||
      p.includes(",") ||
      /[;&|`$<>\s]/.test(p)
    ) {
      return c.json(
        {
          success: false,
          error: `前缀地址不合规 (必须以 https:// 开头并以 / 结尾，且不能包含特殊字符或逗号): ${p}`
        },
        400
      );
    }
  }

  await setRepoWhitelistPrefixes(c.env.CPHW_KV, prefixes);

  const clientIp = c.req.header("cf-connecting-ip") || "unknown-ip";
  await appendAdminAuditLog(c.env.CPHW_KV, {
    operator: "admin",
    action: "update_repo_config",
    target: "config:repo_prefixes",
    details: `更新仓库白名单前缀为: [${prefixes.join(", ")}]`,
    ip: clientIp
  });

  return c.json({ success: true, message: "仓库地址白名单前缀已更新", prefixes });
});

/** 查看管理员操作审计日志 */
adminRoutes.get("/audit-logs", async c => {
  const logs = await getAdminAuditLogs(c.env.CPHW_KV);
  return c.json({ success: true, logs });
});

