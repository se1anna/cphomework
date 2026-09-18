import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./server/types";
import { authRoutes } from "./server/routes/auth.routes";
import { studentRoutes } from "./server/routes/student.routes";
import { adminRoutes } from "./server/routes/admin.routes";
import { computeRoutes } from "./server/routes/compute.routes";
import { ensureDefaultAdmin } from "./server/kv";

const app = new Hono<{ Bindings: Env }>();

// 请求体大小限制 (128KB)
app.use("*", bodyLimit({
  maxSize: 128 * 1024,
  onError: c => c.json({ success: false, error: "请求数据包过大 (最大允许 128KB)" }, 413)
}));

// 安全响应头
app.use("*", secureHeaders({
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
    frameSrc: ["https://challenges.cloudflare.com"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'", "https://challenges.cloudflare.com"]
  }
}));

// 动态环境头与 API 缓存控制
app.use("*", async (c, next) => {
  await next();

  const url = new URL(c.req.url);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const isHttps = url.protocol === "https:";

  if (isHttps && !isLocalhost) {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  } else {
    c.res.headers.delete("Strict-Transport-Security");
  }

  c.res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );

  if (url.pathname.startsWith("/api/")) {
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    c.res.headers.set("Pragma", "no-cache");
  }
});

app.use("*", logger());

function createCorsMiddleware() {
  return cors({
    origin: (origin, c) => {
      if (!origin) return "*";

      const currentUrl = new URL(c.req.url);
      const isLocalhost = currentUrl.hostname === "localhost" || currentUrl.hostname === "127.0.0.1";

      if (isLocalhost) {
        const allowedDevOrigins = [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          "http://localhost:8787",
          "http://127.0.0.1:8787"
        ];
        if (allowedDevOrigins.includes(origin)) return origin;
      }

      const configuredOrigin = (c.env as any).ALLOWED_ORIGIN;
      if (configuredOrigin && origin === configuredOrigin) {
        return origin;
      }
      if (origin === `${currentUrl.protocol}//${currentUrl.host}`) {
        return origin;
      }

      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400
  });
}

app.use("/api/auth/*", createCorsMiddleware());
app.use("/api/student/*", createCorsMiddleware());
app.use("/api/admin/*", createCorsMiddleware());

// 启动时初始化默认管理员账户
let adminInitialized = false;
app.use("/api/*", async (c, next) => {
  if (c.env.CPHW_KV && !adminInitialized) {
    try {
      await ensureDefaultAdmin(c.env.CPHW_KV);
      adminInitialized = true;
    } catch (e) {
      console.error("Failed to ensure default admin:", e);
    }
  }
  await next();
});

// 路由挂载
app.route("/api/auth", authRoutes);
app.route("/api/student", studentRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/compute", computeRoutes);

// 健康检查
app.get("/api/health", async c => {
  return c.json({
    status: "healthy",
    system: "通用作业自动批改系统 - 控制层",
    serverTime: new Date().toISOString()
  });
});

// 全局异常处理
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof SyntaxError) {
    return c.json({ success: false, error: "请求数据包 JSON 格式解析失败" }, 400);
  }
  console.error("[Unhandled Exception]", err);
  return c.json(
    {
      success: false,
      error: "服务器处理请求时遇到异常，请稍后重试或联系课程助教"
    },
    500
  );
});

// 前端静态资源托管兜底
app.all("*", async c => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ success: false, error: "未找到请求的 API 接口" }, 404);
  }
  if (c.env.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("CPHomework Backend API Running. Please build and mount frontend assets.", 404);
});

export default app;
