import type {
  AdminAuditRecord,
  Assignment,
  EmailCooldownRecord,
  EvaluationRound,
  QueueTask,
  Submission,
  SubmissionMetadata,
  TaskLease,
  User,
  VerificationRecord
} from "./types";
import { hashPassword, generateSalt } from "./auth";

const DEFAULT_REPO_PREFIXES = "https://github.com/,https://gitee.com/";

/** 初始化或兼容升级管理员默认账户 (admin / 123456) */
export async function ensureDefaultAdmin(kv: KVNamespace): Promise<void> {
  const existing = await kv.get("user:admin");
  if (!existing) {
    const salt = generateSalt();
    const passwordHash = await hashPassword("123456", salt);
    const adminUser: User = {
      username: "admin",
      role: "admin",
      passwordHash,
      salt,
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tokenVersion: 1,
      isDefaultPassword: true
    };
    await kv.put("user:admin", JSON.stringify(adminUser));
    console.log("[KV] Initialized default admin user (admin / 123456)");
  } else {
    try {
      const admin = JSON.parse(existing) as User;
      // 检查管理员是否为默认密码 (兼容早期 100,000 次迭代生成的密码哈希)
      const isLegacyDefault100k = await hashPassword("123456", admin.salt, 100000);
      const isCurrentDefault50k = await hashPassword("123456", admin.salt, 50000);
      const isStillDefault =
        admin.isDefaultPassword === true ||
        admin.passwordHash === isLegacyDefault100k ||
        admin.passwordHash === isCurrentDefault50k;

      if (isStillDefault) {
        if (admin.passwordHash === isLegacyDefault100k || !admin.isDefaultPassword) {
          admin.passwordHash = isCurrentDefault50k;
          admin.isDefaultPassword = true;
          if (admin.tokenVersion === undefined) admin.tokenVersion = 1;
          await kv.put("user:admin", JSON.stringify(admin));
          console.log("[KV] Upgraded default admin password hash to current 50k standard");
        }
        await resetLoginFailure(kv, "admin");
      }
    } catch {}
  }
}

/** 获取用户信息 */
export async function getUser(kv: KVNamespace, username: string): Promise<User | null> {
  const data = await kv.get(`user:${username}`);
  if (!data) return null;
  try {
    const user = JSON.parse(data) as User;
    if (user.tokenVersion === undefined) {
      user.tokenVersion = 1;
    }
    return user;
  } catch {
    return null;
  }
}

/** 写入/更新用户信息 */
export async function saveUser(kv: KVNamespace, user: User): Promise<void> {
  if (user.tokenVersion === undefined) {
    user.tokenVersion = 1;
  }
  await kv.put(`user:${user.username}`, JSON.stringify(user));

  // 如果是学生，同步维护注册学号索引
  if (user.role === "student" && user.studentId) {
    const regList = await getRegisteredStudentIds(kv);
    if (!regList.includes(user.studentId)) {
      regList.push(user.studentId);
      await kv.put("meta:registered_students", JSON.stringify(regList));
    }
  }
}

/** 校验 JWT 携带的 tokenVersion 是否有效 (密码修改后旧 Token 立即作废) */
export async function isUserTokenValid(
  kv: KVNamespace,
  username: string,
  tokenVersion: number
): Promise<boolean> {
  const user = await getUser(kv, username);
  if (!user) return false;
  return user.tokenVersion === tokenVersion;
}

/** 获取所有已注册学生学号 */
export async function getRegisteredStudentIds(kv: KVNamespace): Promise<string[]> {
  const data = await kv.get("meta:registered_students");
  if (!data) return [];
  try {
    return JSON.parse(data) as string[];
  } catch {
    return [];
  }
}

// -------------------------------------------------------------
// 安全加固：邮件配额保护与 10 分钟冷却控制 (核心要求)
// -------------------------------------------------------------

/** 检查学号是否在 10 分钟邮件冷却期内 */
export async function checkEmailCooldown(
  kv: KVNamespace,
  studentId: string
): Promise<{ inCooldown: boolean; remainingSeconds: number }> {
  const key = `cooldown:email:${studentId}`;
  const data = await kv.get(key);
  if (!data) {
    return { inCooldown: false, remainingSeconds: 0 };
  }

  try {
    const record = JSON.parse(data) as EmailCooldownRecord;
    const now = Date.now();
    if (now < record.expiresAt) {
      const remainingSeconds = Math.max(1, Math.ceil((record.expiresAt - now) / 1000));
      return { inCooldown: true, remainingSeconds };
    }
    await kv.delete(key);
    return { inCooldown: false, remainingSeconds: 0 };
  } catch {
    return { inCooldown: false, remainingSeconds: 0 };
  }
}

/** 设置邮件发送 10 分钟冷却锁 (600秒) */
export async function setEmailCooldown(
  kv: KVNamespace,
  studentId: string,
  cooldownSeconds: number = 600
): Promise<void> {
  const key = `cooldown:email:${studentId}`;
  const now = Date.now();
  const record: EmailCooldownRecord = {
    lastSentAt: now,
    expiresAt: now + cooldownSeconds * 1000
  };
  await kv.put(key, JSON.stringify(record), {
    expirationTtl: cooldownSeconds
  });
}

/** 单 IP 频次限制防刷 (例如 10 分钟最多 5 次) */
export async function checkIpRateLimit(
  kv: KVNamespace,
  ip: string,
  action: string,
  maxRequests: number = 5,
  windowSeconds: number = 600
): Promise<{ allowed: boolean; remaining: number }> {
  if (!ip) return { allowed: true, remaining: maxRequests };
  const key = `ratelimit:ip:${action}:${ip}`;
  const data = await kv.get(key);
  let count = 0;
  if (data) {
    try {
      count = parseInt(data, 10) || 0;
    } catch {}
  }

  if (count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  count += 1;
  await kv.put(key, count.toString(), { expirationTtl: windowSeconds });
  return { allowed: true, remaining: maxRequests - count };
}

// -------------------------------------------------------------
// 验证码管理与防暴力枚举自毁机制
// -------------------------------------------------------------

/** 保存验证码并设置 30 分钟 TTL (1800 秒) */
export async function saveVerificationCode(
  kv: KVNamespace,
  studentId: string,
  code: string,
  email: string
): Promise<void> {
  const now = Date.now();
  const record: VerificationRecord = {
    code,
    studentId,
    email,
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
    failedAttempts: 0
  };

  await kv.put(`verify:${studentId}`, JSON.stringify(record), {
    expirationTtl: 1800
  });
}

/** 获取验证码 */
export async function getVerificationCode(
  kv: KVNamespace,
  studentId: string
): Promise<VerificationRecord | null> {
  const data = await kv.get(`verify:${studentId}`);
  if (!data) return null;
  try {
    const record = JSON.parse(data) as VerificationRecord;
    if (Date.now() > record.expiresAt) {
      await kv.delete(`verify:${studentId}`);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/** 清除邮件发送 10 分钟冷却锁 (用于安全异常熔断或管理解锁) */
export async function clearEmailCooldown(
  kv: KVNamespace,
  studentId: string
): Promise<void> {
  await kv.delete(`cooldown:email:${studentId}`);
}

/** 检查特定客户端与学号对是否被锁定 (5次错误锁定 15 分钟，防止校园网 NAT 误杀) */
export async function isVerificationLockedForPair(
  kv: KVNamespace,
  clientIp: string,
  studentId: string
): Promise<boolean> {
  if (!clientIp || !studentId) return false;
  const countStr = await kv.get(`ratelimit:verify_pair:${clientIp}:${studentId}`);
  if (!countStr) return false;
  return (parseInt(countStr, 10) || 0) >= 5;
}

/** 检查客户端 IP 是否因连续输错验证码被临时锁定 (兼容保留) */
export async function isVerificationLockedForIp(
  kv: KVNamespace,
  clientIp: string
): Promise<boolean> {
  if (!clientIp) return false;
  const countStr = await kv.get(`ratelimit:verify_ip:${clientIp}`);
  if (!countStr) return false;
  return (parseInt(countStr, 10) || 0) >= 5;
}

/** 重置客户端与学号对的验证码错误计数 */
export async function resetVerificationFailuresForPair(
  kv: KVNamespace,
  clientIp: string,
  studentId: string
): Promise<void> {
  if (!clientIp || !studentId) return;
  await kv.delete(`ratelimit:verify_pair:${clientIp}:${studentId}`);
  await kv.delete(`ratelimit:verify_ip:${clientIp}`);
}

/** 重置客户端 IP 的验证码错误计数 (兼容保留) */
export async function resetVerificationFailuresForIp(
  kv: KVNamespace,
  clientIp: string
): Promise<void> {
  if (!clientIp) return;
  await kv.delete(`ratelimit:verify_ip:${clientIp}`);
}

/**
 * 记录验证码输入错误:
 * 1. 采用 (clientIp + studentId) 复合键与客户端 IP 惩戒，防止校园网 NAT 穿透误杀全机房
 * 2. 验证码全局保护：多源暴力尝试达到 15 次仅使验证码失效，绝不解除发信冷却锁，切断邮件轰炸死循环
 */
export async function recordVerificationFailure(
  kv: KVNamespace,
  clientIp: string,
  studentId: string
): Promise<{ ipLocked: boolean; codeExpired: boolean; attemptsLeft: number }> {
  // 1. 攻击源复合维度封禁与 IP 级计数
  let pairFailures = 1;
  const pairKey = `ratelimit:verify_pair:${clientIp}:${studentId}`;
  const pairData = await kv.get(pairKey);
  if (pairData) {
    pairFailures = (parseInt(pairData, 10) || 0) + 1;
  }
  await kv.put(pairKey, pairFailures.toString(), { expirationTtl: 900 });

  const ipKey = `ratelimit:verify_ip:${clientIp}`;
  const ipData = await kv.get(ipKey);
  let ipFailures = 1;
  if (ipData) {
    ipFailures = (parseInt(ipData, 10) || 0) + 1;
  }
  await kv.put(ipKey, ipFailures.toString(), { expirationTtl: 900 });

  const ipLocked = pairFailures >= 5 || ipFailures >= 5;

  // 2. 验证码防多 IP 分布式枚举保护
  let codeExpired = false;
  const data = await kv.get(`verify:${studentId}`);
  if (data) {
    try {
      const record = JSON.parse(data) as VerificationRecord;
      record.failedAttempts = (record.failedAttempts || 0) + 1;

      // 仅当多 IP 累计错达 15 次时使验证码失效，但严禁清除冷却锁，杜绝无限轰炸后门
      if (record.failedAttempts >= 15) {
        await kv.delete(`verify:${studentId}`);
        codeExpired = true;
      } else {
        const remainingSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
        await kv.put(`verify:${studentId}`, JSON.stringify(record), {
          expirationTtl: remainingSeconds
        });
      }
    } catch {}
  }

  const attemptsLeft = Math.max(0, 5 - pairFailures);
  return { ipLocked, codeExpired, attemptsLeft };
}

/** 删除验证码 (核验通过后阅后即焚) */
export async function deleteVerificationCode(
  kv: KVNamespace,
  studentId: string
): Promise<void> {
  await kv.delete(`verify:${studentId}`);
}

// -------------------------------------------------------------
// 登录防爆破与失败锁定
// -------------------------------------------------------------

/** 记录登录失败次数，超 5 次锁定 10 分钟 (600秒) */
export async function recordLoginFailure(
  kv: KVNamespace,
  username: string
): Promise<{ locked: boolean; attemptsLeft: number }> {
  const key = `ratelimit:login:${username}`;
  const data = await kv.get(key);
  let count = 0;
  if (data) {
    count = parseInt(data, 10) || 0;
  }
  count += 1;

  if (count >= 5) {
    await kv.put(`lockout:login:${username}`, "locked", { expirationTtl: 600 });
    await kv.delete(key);
    return { locked: true, attemptsLeft: 0 };
  }

  await kv.put(key, count.toString(), { expirationTtl: 600 });
  return { locked: false, attemptsLeft: 5 - count };
}

/** 检查账号是否处于登录锁定状态 */
export async function isLoginLocked(
  kv: KVNamespace,
  username: string
): Promise<boolean> {
  const data = await kv.get(`lockout:login:${username}`);
  return !!data;
}

/** 登录成功，重置登录失败计数 */
export async function resetLoginFailure(
  kv: KVNamespace,
  username: string
): Promise<void> {
  await kv.delete(`ratelimit:login:${username}`);
  await kv.delete(`lockout:login:${username}`);
}

// -------------------------------------------------------------
// 作业与配置管理
// -------------------------------------------------------------

/** 获取作业列表 */
export async function getAssignments(kv: KVNamespace): Promise<Assignment[]> {
  const data = await kv.get("meta:assignments");
  if (!data) {
    return [];
  }
  try {
    return JSON.parse(data) as Assignment[];
  } catch {
    return [];
  }
}

/** 保存作业列表 */
export async function saveAssignments(
  kv: KVNamespace,
  assignments: Assignment[]
): Promise<void> {
  await kv.put("meta:assignments", JSON.stringify(assignments));
}

/** 获取仓库地址白名单前缀配置 */
export async function getRepoWhitelistPrefixes(kv: KVNamespace): Promise<string[]> {
  const data = await kv.get("config:repo_prefixes");
  const raw = data || DEFAULT_REPO_PREFIXES;
  return raw
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);
}

/** 设置仓库地址白名单前缀 */
export async function setRepoWhitelistPrefixes(
  kv: KVNamespace,
  prefixes: string[]
): Promise<void> {
  await kv.put("config:repo_prefixes", prefixes.join(","));
}

export interface ParsedRepoInfo {
  valid: boolean;
  cleanRepoUrl?: string;
  repoUrl?: string;
  parsedBranch?: string;
  branch?: string;
  parsedSubpath?: string;
  subpath?: string;
  reason?: string;
}

/**
 * 仓库地址规范化与安全解析：
 * 1. 自动剥离尾部多余斜杠与空白；
 * 2. 智能反解 GitHub/Gitee 网页直接复制的 /tree/<branch>/<subpath> 结构；
 * 3. 严格前缀白名单比对与路径穿越防护。
 */
export async function parseAndValidateRepoUrl(
  kv: KVNamespace,
  rawUrl: string,
  explicitBranch?: string,
  explicitSubpath?: string
): Promise<ParsedRepoInfo> {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, reason: "仓库地址不能为空" };
  }

  let clean = rawUrl.trim();
  if (clean.length > 250) {
    return { valid: false, reason: "仓库地址过长 (最多250字符)" };
  }

  // 1. 匹配前缀白名单
  const prefixes = await getRepoWhitelistPrefixes(kv);
  const matchedPrefix = prefixes.find(prefix => clean.startsWith(prefix));
  if (!matchedPrefix) {
    return {
      valid: false,
      reason: `仓库地址前缀不匹配，必须以以下白名单前缀开头: ${prefixes.join(" 或 ")}`
    };
  }

  // 移除尾部多余斜杠
  const pathPart = clean.substring(matchedPrefix.length).replace(/\/+$/, "");

  // 杜绝任何路径穿越
  if (pathPart.includes("..") || pathPart.includes("./") || pathPart.includes("@")) {
    return { valid: false, reason: "仓库地址包含非法字符或路径穿越片段" };
  }

  const parts = pathPart.split("/").filter(Boolean);
  if (parts.length < 2) {
    return { valid: false, reason: "仓库地址格式不合规，路径必须为标准规范的 用户名/仓库名 格式" };
  }

  const owner = parts[0];
  let repo = parts[1];
  if (repo.endsWith(".git")) {
    repo = repo.substring(0, repo.length - 4);
  }

  const nameRegex = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
  if (!nameRegex.test(owner) || !nameRegex.test(repo)) {
    return { valid: false, reason: "用户名或仓库名包含非规范字符" };
  }

  const standardBaseUrl = `${matchedPrefix}${owner}/${repo}`;
  let finalBranch = explicitBranch?.trim();
  let finalSubpath = explicitSubpath?.trim();

  // 智能识别 /tree/<branch>/<subpath> 网页格式
  if (parts.length >= 4 && parts[2] === "tree") {
    if (!finalBranch) {
      finalBranch = parts[3];
    }
    if (!finalSubpath && parts.length > 4) {
      finalSubpath = parts.slice(4).join("/");
    }
  }

  // 校验 branch 安全格式 (必须为安全合法 Git ref，严禁以 '-' 开头防 CLI 选项注入，禁止 '..')
  if (finalBranch) {
    if (finalBranch.startsWith("-") || !/^[a-zA-Z0-9_./-]{1,100}$/.test(finalBranch) || finalBranch.includes("..")) {
      return { valid: false, reason: "Git 分支名称格式不合法 (禁止以 '-' 开头或包含穿越字符)" };
    }
  }

  // 校验 subpath 安全格式 (合法相对子路径，禁止穿越)
  if (finalSubpath) {
    finalSubpath = finalSubpath.replace(/^\/+|\/+$/g, "");
    if (finalSubpath.includes("..") || !/^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/.test(finalSubpath)) {
      return { valid: false, reason: "子目录路径格式不合法" };
    }
  }

  return {
    valid: true,
    cleanRepoUrl: standardBaseUrl,
    repoUrl: standardBaseUrl,
    parsedBranch: finalBranch || undefined,
    branch: finalBranch || undefined,
    parsedSubpath: finalSubpath || undefined,
    subpath: finalSubpath || undefined
  };
}

/** 兼容旧接口的轻量封装 */
export async function validateRepoUrlStrict(
  kv: KVNamespace,
  repoUrl: string
): Promise<{ valid: boolean; reason?: string }> {
  const parsed = await parseAndValidateRepoUrl(kv, repoUrl);
  return { valid: parsed.valid, reason: parsed.reason };
}

// -------------------------------------------------------------
// 提交记录与评测队列管理
// -------------------------------------------------------------

/** 获取某学生特定作业的提交记录 */
export async function getSubmission(
  kv: KVNamespace,
  assignmentId: string,
  studentId: string
): Promise<Submission | null> {
  const key = `submission:${assignmentId}:${studentId}`;
  const data = await kv.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as Submission;
  } catch {
    return null;
  }
}

/** 保存某学生作业提交记录 (基于 KV Key Metadata 隔离写入，彻底杜绝大字典 RMW 并发覆盖) */
export async function saveSubmission(
  kv: KVNamespace,
  submission: Submission
): Promise<void> {
  const key = `submission:${submission.assignmentId}:${submission.studentId}`;
  const metadata: SubmissionMetadata = {
    id: submission.id,
    assignmentId: submission.assignmentId,
    studentId: submission.studentId,
    repoUrl: submission.repoUrl,
    branch: submission.branch,
    subpath: submission.subpath,
    status: submission.status,
    score: submission.score,
    submittedAt: submission.submittedAt,
    gradedAt: submission.gradedAt
  };

  // 原子单键写入，附带原生 metadata
  await kv.put(key, JSON.stringify(submission), { metadata });

  // 同步维护已提交学生索引 (兼容旧版回退与轻量遍历)
  const subListKey = `meta:subs:${submission.assignmentId}`;
  const rawList = await kv.get(subListKey);
  let studentIds: string[] = [];
  if (rawList) {
    try {
      studentIds = JSON.parse(rawList) as string[];
    } catch {}
  }
  if (!studentIds.includes(submission.studentId)) {
    studentIds.push(submission.studentId);
    await kv.put(subListKey, JSON.stringify(studentIds));
  }
}

/** 一次性批量获取某作业的所有提交记录 (利用 kv.list 返回的 metadata，消除 N+1 读放大与写覆盖) */
export async function getSubmissionsForAssignment(
  kv: KVNamespace,
  assignmentId: string
): Promise<Submission[]> {
  const prefix = `submission:${assignmentId}:`;
  const submissions: Submission[] = [];
  let cursor: string | undefined = undefined;

  if (typeof kv.list === "function") {
    try {
      do {
        const list: any = await kv.list<SubmissionMetadata>({
          prefix,
          limit: 1000,
          cursor
        });

        for (const item of list.keys || []) {
          if (item.name.startsWith(prefix)) {
            if (item.metadata) {
              submissions.push({
                id: item.metadata.id,
                assignmentId: item.metadata.assignmentId,
                studentId: item.metadata.studentId,
                repoUrl: item.metadata.repoUrl,
                branch: item.metadata.branch,
                subpath: item.metadata.subpath,
                status: item.metadata.status,
                score: item.metadata.score,
                details: null,
                submittedAt: item.metadata.submittedAt,
                gradedAt: item.metadata.gradedAt
              });
            } else {
              const sid = item.name.substring(prefix.length);
              if (sid) {
                const sub = await getSubmission(kv, assignmentId, sid);
                if (sub) submissions.push(sub);
              }
            }
          }
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);

      if (submissions.length > 0) return submissions;
    } catch {}
  }

  // 降级兼容：若 kv.list 为简易 mock 或未返回 metadata，通过索引列表回查
  const studentIds = await getSubmittedStudentIdsForAssignment(kv, assignmentId);
  for (const sid of studentIds) {
    const sub = await getSubmission(kv, assignmentId, sid);
    if (sub) submissions.push(sub);
  }
  return submissions;
}

/** 获取某作业所有提交的学生学号 */
export async function getSubmittedStudentIdsForAssignment(
  kv: KVNamespace,
  assignmentId: string
): Promise<string[]> {
  const prefix = `submission:${assignmentId}:`;
  const studentIds: string[] = [];
  let cursor: string | undefined = undefined;

  if (typeof kv.list === "function") {
    try {
      do {
        const list: any = await kv.list({ prefix, limit: 1000, cursor });
        for (const item of list.keys || []) {
          if (item.name.startsWith(prefix)) {
            const sid = item.name.substring(prefix.length);
            if (sid && !studentIds.includes(sid)) {
              studentIds.push(sid);
            }
          }
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);

      if (studentIds.length > 0) return studentIds;
    } catch {}
  }

  const subListKey = `meta:subs:${assignmentId}`;
  const rawList = await kv.get(subListKey);
  if (!rawList) return [];
  try {
    return JSON.parse(rawList) as string[];
  } catch {
    return [];
  }
}

/** 检查学生针对某次作业是否已有正在排队或处理中的活跃任务 (任务互斥锁) */
export async function hasActiveTask(
  kv: KVNamespace,
  assignmentId: string,
  studentId: string
): Promise<boolean> {
  const sub = await getSubmission(kv, assignmentId, studentId);
  if (!sub || (sub.status !== "queued" && sub.status !== "in_progress")) {
    return false;
  }

  const now = Date.now();

  // 1. 如果处于 in_progress，按 startedAt 计算 5 分钟超时自愈 (防止沙箱失联死锁)
  if (sub.status === "in_progress") {
    const startTime = sub.startedAt
      ? new Date(sub.startedAt).getTime()
      : (sub.submittedAt ? new Date(sub.submittedAt).getTime() : NaN);
    if (!isNaN(startTime) && now - startTime > 5 * 60 * 1000) {
      console.warn(`[Task Mutex] in_progress task timed out (>5m) for student ${studentId}. Releasing lock.`);
      return false;
    }
    return true;
  }

  // 2. 如果长期处于 queued 未被拉取，按 15 分钟时限自愈
  if (sub.submittedAt) {
    const subTime = new Date(sub.submittedAt).getTime();
    if (!isNaN(subTime) && now - subTime > 15 * 60 * 1000) {
      console.warn(`[Task Mutex] queued task stalled (>15m) for student ${studentId}. Releasing lock.`);
      return false;
    }
  }

  return true;
}

/** 将任务压入评测队列 (使用独立键杜绝高并发竞态覆盖，兼顾旧数组兼容) */
export async function enqueueTask(kv: KVNamespace, task: QueueTask): Promise<void> {
  const paddedTime = Date.now().toString().padStart(15, "0");
  const taskKey = `queue:task:${paddedTime}_${task.taskId}`;
  await kv.put(taskKey, JSON.stringify(task));

  // 同时同步维护 queue:tasks 供简易只读查询与测试 mock 兼容
  const raw = await kv.get("queue:tasks");
  let queue: QueueTask[] = [];
  if (raw) {
    try {
      queue = JSON.parse(raw) as QueueTask[];
    } catch {}
  }
  queue.push(task);
  await kv.put("queue:tasks", JSON.stringify(queue));
}

/**
 * 组装供计算层 Agent 使用的先前评价轮次提示词 (Iteration Prompt)
 */
export function formatEvaluationHistoryPrompt(
  currentRound: number,
  history: EvaluationRound[]
): string {
  const chineseNumbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const roundStr =
    currentRound <= 10 && currentRound >= 1 ? `第${chineseNumbers[currentRound]}次` : `第 ${currentRound} 次`;

  if (!history || history.length === 0) {
    return [
      `【评测迭代轮次说明】`,
      `本次为学生针对该作业的【${roundStr}提交（初始评测）】。`,
      `暂无先前评价记录。请严格对照作业详情与验收标准，对学生的代码进行初次基准评测。`
    ].join("\n");
  }

  let block = `### 先前评价轮次与迭代改进提示词 (Prior Evaluation Feedback)\n\n`;
  block += `> **评测阶段声明**: 本次提交为学生的【${roundStr}提交（第 ${currentRound} 次评测）】。\n`;
  block += `> **评分参考准则**: 请重点对比前序各轮次中指出的问题、扣分项与改进建议，核查学生本次提交是否针对先前的缺陷进行了修复与算法优化。\n`;
  block += `> 若先前问题已修复或测试用例通过率提高，应在合理范围内相应提高评分，支持多轮迭代逐步提升成绩。\n\n`;

  block += `#### 历史评测得分轨迹 (共 ${history.length} 次先验轮次)\n`;
  block += `| 轮次 | 提交时间 | 评测完成时间 | 先前得分 | 核心评语摘要 |\n`;
  block += `| :---: | :--- | :--- | :---: | :--- |\n`;

  for (const item of history) {
    const scoreText = item.score !== null ? `${item.score} 分` : "未出分";
    const subTime = item.submittedAt ? item.submittedAt.replace("T", " ").slice(0, 19) : "-";
    const gradeTime = item.gradedAt ? item.gradedAt.replace("T", " ").slice(0, 19) : "-";
    const summary = (item.details || "")
      .replace(/[#*`|\n\r]/g, " ")
      .trim()
      .slice(0, 80);
    block += `| ${item.roundLabel} | ${subTime} | ${gradeTime} | **${scoreText}** | ${summary}... |\n`;
  }

  block += `\n#### 先前各轮次详细评测档案：\n`;
  for (const item of history) {
    block += `\n---\n`;
    block += `##### 【${item.roundLabel}】详细记录 (先前得分: ${item.score})\n`;
    block += `- **检出仓库/分支**: \`${item.repoUrl}\`${item.branch ? ` (分支: ${item.branch})` : ""}${item.subpath ? ` (目录: ${item.subpath})` : ""}\n`;
    block += `- **评测详情与反馈**:\n\n${item.details || "（无详细记录）"}\n`;
  }

  return block;
}

/** 注册计算沙箱任务租约 */
export async function createTaskLease(kv: KVNamespace, task: QueueTask): Promise<void> {
  const leaseKey = `lease:task:${task.taskId}`;
  const lease: TaskLease = {
    taskId: task.taskId,
    studentId: task.studentId,
    assignmentId: task.assignmentId,
    assignmentTitle: task.assignmentTitle,
    assignmentOverview: task.assignmentOverview,
    assignmentDetails: task.assignmentDetails,
    repoUrl: task.repoUrl,
    branch: task.branch,
    subpath: task.subpath,
    submittedAt: task.submittedAt,
    startedAt: Date.now(),
    retryCount: task.retryCount || 0,
    currentRound: task.currentRound,
    currentRoundLabel: task.currentRoundLabel,
    history: task.history,
    historyPrompt: task.historyPrompt
  };
  await kv.put(leaseKey, JSON.stringify(lease), { expirationTtl: 900 });
}

/** 任务成功出分，清除租约与队列残留 */
export async function completeTask(kv: KVNamespace, taskId: string): Promise<void> {
  const deleteOps: Promise<any>[] = [
    kv.delete(`queue:lease:${taskId}`),
    kv.delete(`lease:task:${taskId}`)
  ];

  if (typeof kv.list === "function") {
    try {
      const list = await kv.list({ prefix: "queue:task:", limit: 50 });
      for (const k of list.keys || []) {
        if (k.name.endsWith(`_${taskId}`)) {
          deleteOps.push(kv.delete(k.name));
        }
      }
    } catch {}
  }

  // 从 queue:tasks 数组同步清理
  const raw = await kv.get("queue:tasks");
  if (raw) {
    try {
      let queue = JSON.parse(raw) as QueueTask[];
      queue = queue.filter(t => t.taskId !== taskId);
      await kv.put("queue:tasks", JSON.stringify(queue));
    } catch {}
  }

  await Promise.allSettled(deleteOps);
}

/** 惰性超时扫描并恢复孤儿任务 (计算沙箱崩溃/超时容灾) */
export async function recoverOrphanedTasks(
  kv: KVNamespace,
  timeoutMs: number = 5 * 60 * 1000,
  maxRetries: number = 1
): Promise<{ recoveredCount: number; failedCount: number }> {
  let recoveredCount = 0;
  let failedCount = 0;

  if (typeof kv.list !== "function") return { recoveredCount, failedCount };

  try {
    const list = await kv.list({ prefix: "lease:task:", limit: 20 });
    const now = Date.now();

    for (const key of list.keys || []) {
      if (!key.name.startsWith("lease:task:")) continue;
      const data = await kv.get(key.name);
      if (!data) continue;

      let lease: TaskLease;
      try {
        lease = JSON.parse(data) as TaskLease;
      } catch {
        await kv.delete(key.name);
        continue;
      }

      if (now - lease.startedAt > timeoutMs) {
        console.warn(`[Lease Timeout] Task ${lease.taskId} expired (${now - lease.startedAt}ms). Recovering...`);
        await kv.delete(key.name);
        await kv.delete(`queue:lease:${lease.taskId}`);

        const existingSub = await getSubmission(kv, lease.assignmentId, lease.studentId);
        if (existingSub && existingSub.activeTaskId === lease.taskId) {
          if (lease.retryCount < maxRetries) {
            const retryTask: QueueTask = {
              taskId: `task-${Date.now()}-r${lease.retryCount + 1}`,
              studentId: lease.studentId,
              assignmentId: lease.assignmentId,
              assignmentTitle: lease.assignmentTitle,
              assignmentOverview: lease.assignmentOverview,
              assignmentDetails: lease.assignmentDetails,
              repoUrl: lease.repoUrl,
              branch: lease.branch,
              subpath: lease.subpath,
              submittedAt: lease.submittedAt,
              retryCount: lease.retryCount + 1,
              currentRound: lease.currentRound,
              currentRoundLabel: lease.currentRoundLabel,
              history: lease.history,
              historyPrompt: lease.historyPrompt
            };

            existingSub.activeTaskId = retryTask.taskId;
            existingSub.status = "queued";
            existingSub.details = `上一次评测节点异常超时中断，系统已自动触发重新排队 (第 ${lease.retryCount + 1} 次重试)...`;
            await saveSubmission(kv, existingSub);
            await enqueueTask(kv, retryTask);
            recoveredCount++;
            console.log(`[Lease Recovered] Re-enqueued task ${retryTask.taskId} for student ${lease.studentId}`);
          } else {
            existingSub.activeTaskId = undefined;
            existingSub.lastTaskId = lease.taskId;
            existingSub.status = "graded";
            existingSub.score = 0;
            existingSub.gradedAt = new Date().toISOString();
            existingSub.details =
              "[评测沙箱超时告警] 沙箱在执行测试用例期间异常终止或超时（可能因代码死循环、内存溢出 OOM 或节点异常）。重试均未恢复，请检查程序实现后重新提交。";
            await saveSubmission(kv, existingSub);
            failedCount++;
            console.error(`[Poison Pill Prevented] Marked student ${lease.studentId} task ${lease.taskId} as failed.`);
          }
        }
      }
    }
  } catch (err) {
    console.error("[Lease Recovery Error]", err);
  }

  return { recoveredCount, failedCount };
}

/**
 * 计算层出队拉取下一个任务:
 * 1. 探测候选任务并原子抢占租约凭证 (queue:lease:${taskId})
 * 2. 循环过滤已被删除但仍处于传播期的键
 * 3. 兼容单测与无 list 环境的回退
 */
export async function dequeueTask(
  kv: KVNamespace,
  workerId: string = `worker-${Math.random().toString(36).substring(2, 8)}`
): Promise<QueueTask | null> {
  const claimToken = `${workerId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 1. 优先使用 kv.list 扫描候选键
  if (typeof kv.list === "function") {
    try {
      const list = await kv.list({ prefix: "queue:task:", limit: 20 });
      const matchedKeys = (list.keys || [])
        .map((k: any) => k.name)
        .filter((n: string) => n.startsWith("queue:task:"))
        .sort();

      for (const taskKey of matchedKeys) {
        const underscoreIdx = taskKey.indexOf("_");
        if (underscoreIdx === -1) continue;
        const taskId = taskKey.substring(underscoreIdx + 1);
        const leaseKey = `queue:lease:${taskId}`;

        // A. 探测该任务是否已有正在执行中的有效租约
        const existingLease = await kv.get(leaseKey);
        if (existingLease) {
          continue; // 正在被其他计算节点评测中，跳过
        }

        // B. 尝试抢占租约 (180秒 TTL 自动防崩溃释放)
        await kv.put(leaseKey, claimToken, { expirationTtl: 180 });

        // C. 立即回读仲裁抢占结果 (Read-Your-Own-Writes)
        const claimedBy = await kv.get(leaseKey);
        if (claimedBy !== claimToken) {
          continue; // 微秒并发碰撞被其他 Worker 抢占，继续探测下一个
        }

        // D. 成功获得租约，读取任务内容
        const data = await kv.get(taskKey);
        if (!data) {
          // 该键为传播延迟中的幽灵键，清理租约并继续探索，防止队列阻塞！
          await kv.delete(leaseKey);
          continue;
        }

        try {
          const parsed = JSON.parse(data) as QueueTask;
          return parsed;
        } catch {
          await kv.delete(taskKey);
          await kv.delete(leaseKey);
          continue;
        }
      }
    } catch {}
  }

  // 2. 兼容兜底旧版数组队列 (用于简易测试 mock)
  const raw = await kv.get("queue:tasks");
  if (!raw) return null;
  let queue: QueueTask[] = [];
  try {
    queue = JSON.parse(raw) as QueueTask[];
  } catch {
    return null;
  }
  if (queue.length === 0) return null;

  const nextTask = queue.shift()!;
  await kv.put("queue:tasks", JSON.stringify(queue));
  return nextTask;
}

/** 获取当前任务队列积压长度 (支持游标循环，消除 1000 截断) */
export async function getQueueLength(kv: KVNamespace): Promise<number> {
  if (typeof kv.list === "function") {
    try {
      let count = 0;
      let cursor: string | undefined = undefined;
      do {
        const list: any = await kv.list({ prefix: "queue:task:", limit: 1000, cursor });
        for (const item of list.keys || []) {
          if (item.name.startsWith("queue:task:")) count++;
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);
      if (count > 0) return count;
    } catch {}
  }
  const raw = await kv.get("queue:tasks");
  if (!raw) return 0;
  try {
    const queue = JSON.parse(raw) as QueueTask[];
    return queue.length;
  } catch {
    return 0;
  }
}

// -------------------------------------------------------------
// 管理后台轻量级操作审计日志
// -------------------------------------------------------------

export async function appendAdminAuditLog(
  kv: KVNamespace,
  record: Omit<AdminAuditRecord, "id" | "timestamp">
): Promise<void> {
  const fullRecord: AdminAuditRecord = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    ...record,
    timestamp: new Date().toISOString()
  };

  const key = "meta:admin_audit_logs";
  const raw = await kv.get(key);
  let logs: AdminAuditRecord[] = [];
  if (raw) {
    try {
      logs = JSON.parse(raw);
    } catch {}
  }
  logs.unshift(fullRecord);
  if (logs.length > 100) logs = logs.slice(0, 100);
  await kv.put(key, JSON.stringify(logs));
}

export async function getAdminAuditLogs(kv: KVNamespace): Promise<AdminAuditRecord[]> {
  const raw = await kv.get("meta:admin_audit_logs");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AdminAuditRecord[];
  } catch {
    return [];
  }
}

