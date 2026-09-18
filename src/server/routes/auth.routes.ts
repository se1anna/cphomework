import { Hono } from "hono";
import type { Env, User } from "../types";
import { isStudentInWhitelist } from "../../config/whitelist";
import {
  createAuthToken,
  generateSalt,
  generateVerificationCode,
  hashPassword,
  safeCompare,
  sendEmailVerificationCode,
  verifyAuthToken,
  verifyTurnstileToken,
  verifyUserPassword
} from "../auth";
import {
  checkEmailCooldown,
  checkIpRateLimit,
  clearEmailCooldown,
  deleteVerificationCode,
  ensureDefaultAdmin,
  getUser,
  getVerificationCode,
  isLoginLocked,
  isUserTokenValid,
  isVerificationLockedForIp,
  isVerificationLockedForPair,
  recordLoginFailure,
  recordVerificationFailure,
  resetLoginFailure,
  resetVerificationFailuresForIp,
  resetVerificationFailuresForPair,
  saveUser,
  saveVerificationCode,
  setEmailCooldown
} from "../kv";

export const authRoutes = new Hono<{ Bindings: Env }>();

/** 发送验证码 */
authRoutes.post("/send-code", async c => {
  const { studentId, turnstileToken } = await c.req.json<{
    studentId?: string;
    turnstileToken?: string;
  }>();

  if (!studentId || !studentId.trim()) {
    return c.json({ success: false, error: "请输入学号" }, 400);
  }

  const cleanId = studentId.trim();

  // 校验学号格式
  if (!/^\d{13}$/.test(cleanId)) {
    return c.json({ success: false, error: "学号格式不合规，必须为13位纯数字" }, 400);
  }

  // 核验白名单
  if (!isStudentInWhitelist(cleanId)) {
    return c.json(
      {
        success: false,
        error: `学号 ${cleanId} 未在选课白名单中，请核对学号或联系课程助教`
      },
      403
    );
  }

  const clientIp = c.req.header("cf-connecting-ip") || "unknown-ip";

  // Turnstile 验证
  const isAllowTest = c.env.ALLOW_TEST_TURNSTILE === "true";
  const isTurnstileValid = await verifyTurnstileToken(
    turnstileToken || "",
    c.env.TURNSTILE_SECRET_KEY,
    clientIp,
    isAllowTest
  );

  if (!isTurnstileValid) {
    return c.json({ success: false, error: "人机安全验证未通过，请重新验证" }, 400);
  }

  // IP 限频
  const ipLimit = await checkIpRateLimit(c.env.CPHW_KV, clientIp, "send_code", 30, 600);
  if (!ipLimit.allowed) {
    return c.json(
      {
        success: false,
        error: "当前网络请求验证码过于频繁，请10分钟后再试，以保护系统邮件配额"
      },
      429
    );
  }

  // 邮件发送冷却检查
  const cooldown = await checkEmailCooldown(c.env.CPHW_KV, cleanId);
  if (cooldown.inCooldown) {
    const mins = Math.floor(cooldown.remainingSeconds / 60);
    const secs = cooldown.remainingSeconds % 60;
    const timeDesc = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
    return c.json(
      {
        success: false,
        error: `验证码在10分钟内已发送过，请查收学生邮箱（含垃圾箱）。如未收到，必须等待 ${timeDesc} 后才能再次发送，防止滥用额度。`,
        remainingSeconds: cooldown.remainingSeconds
      },
      429
    );
  }

  // 设置冷却锁 (600秒)
  await setEmailCooldown(c.env.CPHW_KV, cleanId, 600);

  // 生成 6 位验证码并写入 KV (30 分钟 TTL)
  const code = generateVerificationCode();
  const studentEmail = `${cleanId}@whu.edu.cn`;

  await saveVerificationCode(c.env.CPHW_KV, cleanId, code, studentEmail);

  // 发送邮件
  const mailResult = await sendEmailVerificationCode(
    c.env,
    cleanId,
    studentEmail,
    code
  );

  return c.json({
    success: true,
    email: studentEmail,
    devCode: mailResult.devCode,
    message: `验证码已发送至 ${studentEmail}，有效时间30分钟（10分钟内不可重复发送）`
  });
});

/** 验证码注册或重置密码 */
authRoutes.post("/register-or-reset", async c => {
  const { studentId, code, password, turnstileToken } = await c.req.json<{
    studentId?: string;
    code?: string;
    password?: string;
    turnstileToken?: string;
  }>();

  if (!studentId || !code || !password) {
    return c.json({ success: false, error: "缺少学号、验证码或密码" }, 400);
  }

  const cleanId = studentId.trim();

  // 校验学号格式
  if (!/^\d{13}$/.test(cleanId)) {
    return c.json({ success: false, error: "学号格式不合规，必须为13位纯数字" }, 400);
  }

  const clientIp = c.req.header("cf-connecting-ip") || "unknown-ip";

  // 检查验证码输错锁定
  if (await isVerificationLockedForPair(c.env.CPHW_KV, clientIp, cleanId)) {
    return c.json(
      {
        success: false,
        error: "当前设备对该学号连续输错验证码已达5次，已被临时限制15分钟（真实学生在其他设备或网络不受影响）。"
      },
      429
    );
  }

  // Turnstile 验证
  if (!turnstileToken && c.env.ALLOW_TEST_TURNSTILE !== "true") {
    return c.json({ success: false, error: "人机安全验证未通过，请完成验证后再试" }, 400);
  }

  if (turnstileToken) {
    const isAllowTest = c.env.ALLOW_TEST_TURNSTILE === "true";
    const isTurnstileValid = await verifyTurnstileToken(
      turnstileToken,
      c.env.TURNSTILE_SECRET_KEY,
      clientIp,
      isAllowTest
    );
    if (!isTurnstileValid) {
      return c.json({ success: false, error: "人机安全验证未通过，请重新验证" }, 400);
    }
  }

  if (!isStudentInWhitelist(cleanId)) {
    return c.json({ success: false, error: "学号未在白名单中" }, 403);
  }

  if (password.length < 6 || password.length > 64) {
    return c.json({ success: false, error: "密码长度必须在 6 到 64 个字符之间" }, 400);
  }

  const record = await getVerificationCode(c.env.CPHW_KV, cleanId);
  if (!record) {
    return c.json({ success: false, error: "验证码不存在或已超时作废，请重新获取" }, 400);
  }

  // 恒定时间比对验证码
  if (!safeCompare(record.code, code.trim())) {
    const failOutcome = await recordVerificationFailure(c.env.CPHW_KV, clientIp, cleanId);
    if (failOutcome.ipLocked) {
      return c.json(
        {
          success: false,
          error: "当前设备连续输错验证码已达5次，已被临时限制15分钟。原邮箱验证码依然有效，真实学生可在其他设备正常使用。"
        },
        429
      );
    }
    if (failOutcome.codeExpired) {
      return c.json(
        {
          success: false,
          error: "检测到多源异常碰撞尝试，该验证码已启动失效保护，请等待冷却期后重新获取验证码。"
        },
        429
      );
    }
    return c.json(
      {
        success: false,
        error: `验证码错误！当前设备还剩 ${failOutcome.attemptsLeft} 次尝试机会`
      },
      400
    );
  }

  // 验证通过：删除验证码并清理失败记录
  await deleteVerificationCode(c.env.CPHW_KV, cleanId);
  await resetVerificationFailuresForPair(c.env.CPHW_KV, clientIp, cleanId);
  await resetLoginFailure(c.env.CPHW_KV, cleanId);

  const existingUser = await getUser(c.env.CPHW_KV, cleanId);
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const nowStr = new Date().toISOString();

  let user: User;
  if (existingUser) {
    user = {
      ...existingUser,
      passwordHash,
      salt,
      updatedAt: nowStr,
      tokenVersion: (existingUser.tokenVersion || 1) + 1, // 自增令牌版本号
      isDefaultPassword: false
    };
  } else {
    user = {
      username: cleanId,
      studentId: cleanId,
      role: "student",
      passwordHash,
      salt,
      registeredAt: nowStr,
      updatedAt: nowStr,
      tokenVersion: 1,
      isDefaultPassword: false
    };
  }

  await saveUser(c.env.CPHW_KV, user);

  // 签发 JWT
  const token = await createAuthToken(user.username, user.role, user.tokenVersion, c.env.JWT_SECRET);

  return c.json({
    success: true,
    message: existingUser ? "密码已重置并成功登录" : "注册成功并已自动登录",
    token,
    user: {
      username: user.username,
      studentId: user.studentId,
      role: user.role
    }
  });
});

/** 用户登录 */
authRoutes.post("/login", async c => {
  const clientIp = c.req.header("cf-connecting-ip") || "unknown-ip";

  // IP 级登录限频
  const ipLimit = await checkIpRateLimit(c.env.CPHW_KV, clientIp, "login_attempt", 25, 300);
  if (!ipLimit.allowed) {
    return c.json({ success: false, error: "当前网络登录尝试过于频繁，请5分钟后再试" }, 429);
  }

  const { username, password, turnstileToken } = await c.req.json<{
    username?: string;
    password?: string;
    turnstileToken?: string;
  }>();

  if (!username || !password) {
    return c.json({ success: false, error: "请输入学号/用户名和密码" }, 400);
  }

  const cleanUsername = username.trim();

  // 校验用户名格式
  if (cleanUsername !== "admin" && !/^\d{13}$/.test(cleanUsername)) {
    return c.json({ success: false, error: "用户名或学号格式不合法" }, 400);
  }

  // 校验密码长度
  if (password.length < 6 || password.length > 64) {
    return c.json({ success: false, error: "密码格式不合法" }, 400);
  }

  // Turnstile 验证
  if (turnstileToken) {
    const isAllowTest = c.env.ALLOW_TEST_TURNSTILE === "true";
    const isTurnstileValid = await verifyTurnstileToken(
      turnstileToken,
      c.env.TURNSTILE_SECRET_KEY,
      clientIp,
      isAllowTest
    );
    if (!isTurnstileValid) {
      return c.json({ success: false, error: "人机安全验证未通过，请重试" }, 400);
    }
  }

  if (cleanUsername === "admin") {
    await ensureDefaultAdmin(c.env.CPHW_KV);
  }

  if (await isLoginLocked(c.env.CPHW_KV, cleanUsername)) {
    return c.json(
      {
        success: false,
        error: "密码错误次数过多，该账户已被临时锁定10分钟，请稍后再试"
      },
      429
    );
  }

  const user = await getUser(c.env.CPHW_KV, cleanUsername);
  if (!user) {
    return c.json(
      {
        success: false,
        error: cleanUsername === "admin" ? "管理员账户不存在" : "该学号尚未注册，请先点击注册"
      },
      401
    );
  }

  const verifyOutcome = await verifyUserPassword(password, user);
  if (!verifyOutcome.valid) {
    const failOutcome = await recordLoginFailure(c.env.CPHW_KV, cleanUsername);
    if (failOutcome.locked) {
      return c.json(
        {
          success: false,
          error: "连续密码错误达到5次，账户已被临时锁定10分钟，请稍后再试"
        },
        429
      );
    }
    return c.json(
      {
        success: false,
        error: `密码错误，还剩 ${failOutcome.attemptsLeft} 次重试机会`
      },
      401
    );
  }

  // 平滑升级密码哈希迭代次数
  if (verifyOutcome.needsRehash) {
    user.passwordHash = await hashPassword(password, user.salt, 50000);
    if (cleanUsername === "admin" && password === "123456") {
      user.isDefaultPassword = true;
    }
    await saveUser(c.env.CPHW_KV, user);
  }

  await resetLoginFailure(c.env.CPHW_KV, cleanUsername);

  // 复核选课白名单
  if (user.role === "student" && !isStudentInWhitelist(cleanUsername)) {
    return c.json(
      {
        success: false,
        error: `学号 ${cleanUsername} 当前未在选课白名单中，如有疑问请联系助教`
      },
      403
    );
  }

  // 检查是否使用默认密码
  let isDefaultAdminPassword = false;
  if (user.role === "admin" && (user.isDefaultPassword === true || password === "123456")) {
    isDefaultAdminPassword = true;
  }

  const token = await createAuthToken(
    user.username,
    user.role,
    user.tokenVersion || 1,
    c.env.JWT_SECRET
  );

  return c.json({
    success: true,
    token,
    user: {
      username: user.username,
      studentId: user.studentId,
      role: user.role,
      isDefaultAdminPassword
    }
  });
});

/** 修改密码 */
authRoutes.post("/change-password", async c => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "未授权" }, 401);
  }

  const token = authHeader.substring(7);
  const payload = await verifyAuthToken(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ success: false, error: "登录凭证已失效，请重新登录" }, 401);
  }

  // 校验 Token 版本号
  const isTokenValid = await isUserTokenValid(c.env.CPHW_KV, payload.username, payload.tokenVersion);
  if (!isTokenValid) {
    return c.json({ success: false, error: "登录凭证已作废，请使用新密码重新登录" }, 401);
  }

  const { oldPassword, newPassword, turnstileToken } = await c.req.json<{
    oldPassword?: string;
    newPassword?: string;
    turnstileToken?: string;
  }>();

  if (!oldPassword || !newPassword) {
    return c.json({ success: false, error: "请输入旧密码和新密码" }, 400);
  }

  if (newPassword.length < 6 || newPassword.length > 64) {
    return c.json({ success: false, error: "新密码长度必须在 6 到 64 个字符之间" }, 400);
  }

  if (newPassword === "123456" || newPassword === oldPassword) {
    return c.json({ success: false, error: "新密码不能与原密码或默认初始弱密码相同" }, 400);
  }

  // Turnstile 验证
  const isAllowTest = c.env.ALLOW_TEST_TURNSTILE === "true";
  const clientIp = c.req.header("cf-connecting-ip");
  const isTurnstileValid = await verifyTurnstileToken(
    turnstileToken || "",
    c.env.TURNSTILE_SECRET_KEY,
    clientIp,
    isAllowTest
  );

  if (!isTurnstileValid) {
    return c.json({ success: false, error: "人机安全验证失败" }, 400);
  }

  const user = await getUser(c.env.CPHW_KV, payload.username);
  if (!user) {
    return c.json({ success: false, error: "用户不存在" }, 404);
  }

  const oldVerify = await verifyUserPassword(oldPassword, user);
  if (!oldVerify.valid) {
    return c.json({ success: false, error: "原密码不正确" }, 400);
  }

  const newSalt = generateSalt();
  const newHash = await hashPassword(newPassword, newSalt);

  user.passwordHash = newHash;
  user.salt = newSalt;
  user.updatedAt = new Date().toISOString();
  user.tokenVersion = (user.tokenVersion || 1) + 1; // 自增令牌版本号
  user.isDefaultPassword = false;

  await saveUser(c.env.CPHW_KV, user);

  return c.json({ success: true, message: "密码修改成功，其他设备会话已强制下线" });
});

/** 获取当前用户信息 */
authRoutes.get("/me", async c => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "未登录" }, 401);
  }

  const token = authHeader.substring(7);
  const payload = await verifyAuthToken(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ success: false, error: "登录已失效" }, 401);
  }

  const isTokenValid = await isUserTokenValid(c.env.CPHW_KV, payload.username, payload.tokenVersion);
  if (!isTokenValid) {
    return c.json({ success: false, error: "登录凭证已失效（密码曾被重置），请重新登录" }, 401);
  }

  const user = await getUser(c.env.CPHW_KV, payload.username);
  if (!user) {
    return c.json({ success: false, error: "用户不存在" }, 404);
  }

  return c.json({
    success: true,
    user: {
      username: user.username,
      studentId: user.studentId,
      role: user.role,
      registeredAt: user.registeredAt
    }
  });
});

/** 登出 */
authRoutes.post("/logout", async c => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: true, message: "已退出登录" });
  }

  const token = authHeader.substring(7);
  const payload = await verifyAuthToken(token, c.env.JWT_SECRET);
  if (payload) {
    const user = await getUser(c.env.CPHW_KV, payload.username);
    if (user) {
      user.tokenVersion = (user.tokenVersion || 1) + 1;
      await saveUser(c.env.CPHW_KV, user);
    }
  }

  return c.json({ success: true, message: "已安全登出，历史会话凭证已作废" });
});

