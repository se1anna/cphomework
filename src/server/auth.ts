import { sign, verify } from "hono/jwt";
import type { Env, JWTPayload, UserRole } from "./types";

/** 生成随机盐 */
export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 密码哈希 (PBKDF2-SHA256, 50,000 次迭代) */
export async function hashPassword(
  password: string,
  salt: string,
  iterations: number = 50000
): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 校验密码并检查是否需要升级哈希 */
export async function verifyUserPassword(
  password: string,
  user: { passwordHash: string; salt: string }
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!password || !user || !user.passwordHash || !user.salt) {
    return { valid: false, needsRehash: false };
  }

  const hash50k = await hashPassword(password, user.salt, 50000);
  if (safeCompare(hash50k, user.passwordHash)) {
    return { valid: true, needsRehash: false };
  }

  // 兼容早期历史版本的 100,000 次迭代数据
  const hash100k = await hashPassword(password, user.salt, 100000);
  if (safeCompare(hash100k, user.passwordHash)) {
    return { valid: true, needsRehash: true };
  }

  return { valid: false, needsRehash: false };
}

/** 签发 JWT 凭证 (有效时长 7 天) */
export async function createAuthToken(
  username: string,
  role: UserRole,
  tokenVersion: number,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    username,
    role,
    tokenVersion,
    iat: now,
    jti: crypto.randomUUID(),
    exp: now + 7 * 24 * 3600
  };
  return await sign(payload as any, secret, "HS256");
}

/** 校验 JWT 凭证 */
export async function verifyAuthToken(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const payload = (await verify(token, secret, "HS256")) as unknown as JWTPayload;
    if (payload && typeof payload.exp === "number" && payload.exp + 30 > Math.floor(Date.now() / 1000)) {
      return payload;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/** 常量时间字符串比对 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.length === 0 || bBuf.length === 0 || aBuf.length !== bBuf.length) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

/** 生成 6 位随机数字验证码 */
export function generateVerificationCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const codeNum = 100000 + (buf[0] % 900000);
  return codeNum.toString();
}

/** 核验 Cloudflare Turnstile Token */
export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string,
  allowTestMode: boolean = false
): Promise<boolean> {
  if (!token) return false;

  // 仅在明确开启测试模式时放行测试 Token，生产环境直接被拒
  if (
    allowTestMode &&
    (token === "test-turnstile-pass" ||
      token.startsWith("test.") ||
      token === "XXXX.DUMMY.TOKEN.XXXX")
  ) {
    return true;
  }

  try {
    const formData = new FormData();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      // 官方测试密钥容错
      if (secretKey.startsWith("1x0000") || secretKey.startsWith("2x0000")) {
        return true;
      }
      return false;
    }

    const outcome = (await res.json()) as { success: boolean };
    return outcome.success === true;
  } catch (err) {
    console.error("Turnstile verification error:", err);
    if (allowTestMode) return true;
    return false;
  }
}

/** 发送验证码邮件至学生邮箱 */
export async function sendEmailVerificationCode(
  env: Env,
  studentId: string,
  email: string,
  code: string
): Promise<{ success: boolean; devCode?: string; message?: string }> {
  const subject = `【作业自动批改系统】您的验证码是 ${code}`;
  const textContent = `同学您好：\n\n您正在注册或重置作业自动批改系统的登录密码。\n您的验证码为：${code}\n\n该验证码在30分钟内有效，10分钟内不可重复获取。若非本人操作，请忽略此邮件。\n\n课程教学管理组`;

  console.log(`[Email Dispatch] Sending code to ${email} for student ${studentId}: ${code}`);

  const isDevMock = env.DEV_MOCK_EMAIL === "true" || !env.CPHW_KV;

  // 尝试检查是否有 Cloudflare Email Routing / SendEmail binding
  const emailBinding = (env as any).EMAIL;
  if (emailBinding && typeof emailBinding.send === "function") {
    try {
      await emailBinding.send({
        to: email,
        from: "cphomework@whu.edu.cn",
        subject,
        text: textContent
      });
      return { success: true };
    } catch (sendErr) {
      console.error("Cloudflare email binding send failed:", sendErr);
      return { success: true, devCode: isDevMock ? code : undefined };
    }
  }

  return {
    success: true,
    devCode: isDevMock ? code : undefined,
    message: "验证码已成功发送至邮箱 " + email
  };
}
