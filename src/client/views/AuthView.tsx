import React, { useState, useEffect } from "react";
import {
  GraduationCap,
  Lock,
  EnvelopeSimple,
  CheckCircle,
  Warning,
  Key,
  ArrowRight,
  Clock,
  Eye,
  EyeSlash,
  Sparkle
} from "@phosphor-icons/react";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { copyToClipboard } from "../utils/clipboard";

interface AuthViewProps {
  onLoginSuccess: (token: string, user: any) => void;
  noticeMessage?: string | null;
}

export const AuthView: React.FC<AuthViewProps> = ({ onLoginSuccess, noticeMessage }) => {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");

  // 登录状态
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  // 注册/重置状态
  const [studentId, setStudentId] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [codeDevHint, setCodeDevHint] = useState<string | null>(null);
  const [sendCodeLoading, setSendCodeLoading] = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  // 10分钟邮件冷却倒计时 (秒)
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 倒计时计时器
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // 1. 发送验证码 (严格执行 10 分钟发送冷却拦截)
  const handleSendCode = async () => {
    setError(null);
    setMessage(null);

    const cleanId = studentId.trim();
    if (!cleanId) {
      setError("请输入学号后再获取验证码");
      return;
    }

    if (!/^\d{13}$/.test(cleanId)) {
      setError("学号格式不合规，必须为13位选课学号 (例如 2023302020001)");
      return;
    }

    if (cooldownSeconds > 0) {
      const mins = Math.floor(cooldownSeconds / 60);
      const secs = cooldownSeconds % 60;
      setError(`验证码在10分钟内已发过，请检查邮箱。必须等待 ${mins > 0 ? `${mins}分` : ""}${secs}秒后才能再次发送，防止滥用发信额度。`);
      return;
    }

    if (!turnstileToken) {
      setError("请先完成下方安全人机验证");
      return;
    }

    setSendCodeLoading(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: cleanId,
          turnstileToken
        })
      });

      const data = (await res.json()) as any;

      // 429 冷却拦截处理
      if (res.status === 429 && data.remainingSeconds) {
        setCooldownSeconds(data.remainingSeconds);
        throw new Error(data.error || "10分钟内已发送过验证码，请查收邮箱");
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || "发送验证码失败");
      }

      setCooldownSeconds(600); // 成功发送后启动 10 分钟 (600秒) 本地冷却
      setMessage(data.message || `验证码已发送至 ${cleanId}@whu.edu.cn (有效时间30分钟，10分钟防刷锁定)`);
      if (data.devCode) {
        setCodeDevHint(data.devCode);
      }
    } catch (err: any) {
      setError(err.message || "请求失败，请检查网络或联系助教");
    } finally {
      setSendCodeLoading(false);
    }
  };

  // 2. 注册或重置密码并自动登录
  const handleRegisterOrReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const cleanId = studentId.trim();
    if (!cleanId || !code.trim() || !newPassword) {
      setError("请完整填写学号、验证码和密码");
      return;
    }

    if (!/^\d{13}$/.test(cleanId)) {
      setError("学号必须为 13 位纯数字");
      return;
    }

    if (newPassword.length < 6 || newPassword.length > 64) {
      setError("密码长度必须在 6 到 64 个字符之间");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致，请重新确认");
      return;
    }

    setRegLoading(true);
    try {
      const res = await fetch("/api/auth/register-or-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: cleanId,
          code: code.trim(),
          password: newPassword,
          turnstileToken: turnstileToken || undefined
        })
      });

      const data = (await res.json()) as any;
      if (data.cooldownReset) {
        setCooldownSeconds(0);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "验证失败");
      }

      onLoginSuccess(data.token, data.user);
    } catch (err: any) {
      setError(err.message || "验证失败，请重试");
    } finally {
      setRegLoading(false);
    }
  };

  // 3. 密码登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const cleanUser = loginUsername.trim();
    if (!cleanUser || !loginPassword) {
      setError("请输入学号/用户名和密码");
      return;
    }

    setLoginLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUser,
          password: loginPassword
        })
      });

      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "登录失败");
      }

      onLoginSuccess(data.token, data.user);
    } catch (err: any) {
      setError(err.message || "登录失败，请核对学号密码");
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center py-10 px-4 bg-gradient-to-b from-slate-100 via-slate-50 to-slate-200">
      <div className="w-full max-w-[440px] bg-white rounded-3xl shadow-xl shadow-slate-200/70 border border-slate-200/90 overflow-hidden transition-all">
        {/* Header */}
        <div className="bg-gradient-to-br from-[#0c2340] via-[#16325c] to-[#0f172a] text-white p-6 sm:p-7 text-center relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-sky-500/10 rounded-full blur-xl pointer-events-none" />
          <div className="absolute -left-8 -bottom-8 w-32 h-32 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />

          <div className="inline-flex p-3 bg-white/10 rounded-2xl backdrop-blur-md mb-3 ring-1 ring-white/20 shadow-inner">
            <GraduationCap size={36} weight="duotone" className="text-sky-300" />
          </div>
          <div className="inline-block px-2.5 py-0.5 bg-sky-500/20 text-sky-200 text-[11px] font-medium rounded-full mb-2 tracking-wide">
            课程教学与自动化评测
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight leading-tight">
            通用作业自动批改系统
          </h1>
          <p className="text-xs text-slate-300 mt-1.5 opacity-90">
            自动化代码评测与作业管理平台
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-200/80 bg-slate-50/70 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab("login");
              setError(null);
              setMessage(null);
            }}
            className={`flex-1 py-2.5 text-xs font-semibold text-center rounded-xl transition-all cursor-pointer ${
              activeTab === "login"
                ? "text-blue-600 bg-white shadow-xs border border-slate-200/70"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/60"
            }`}
          >
            密码登录
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("register");
              setError(null);
              setMessage(null);
            }}
            className={`flex-1 py-2.5 text-xs font-semibold text-center rounded-xl transition-all cursor-pointer ${
              activeTab === "register"
                ? "text-blue-600 bg-white shadow-xs border border-slate-200/70"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/60"
            }`}
          >
            首次注册 / 重置密码
          </button>
        </div>

        <div className="p-6 sm:p-7">
          {/* Notifications */}
          {noticeMessage && !error && !message && (
            <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200/80 rounded-2xl text-xs text-amber-800 flex items-start gap-2.5 leading-relaxed break-words-safe animate-in fade-in">
              <Warning size={17} className="shrink-0 mt-0.5 text-amber-600" />
              <span>{noticeMessage}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200/80 rounded-2xl text-xs text-rose-700 flex items-start gap-2.5 leading-relaxed break-words-safe animate-in fade-in">
              <Warning size={17} className="shrink-0 mt-0.5 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {message && (
            <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-2xl text-xs text-emerald-700 flex items-start gap-2.5 leading-relaxed break-words-safe animate-in fade-in">
              <CheckCircle size={17} className="shrink-0 mt-0.5 text-emerald-600" />
              <span>{message}</span>
            </div>
          )}

          {codeDevHint && (
            <div className="mb-4 p-3 bg-indigo-50/80 border border-indigo-200/70 rounded-2xl text-xs text-indigo-900 flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkle size={16} className="text-indigo-600 shrink-0" />
                <span className="truncate">【测试提示】验证码：<strong className="font-mono">{codeDevHint}</strong></span>
              </div>
              <button
                type="button"
                onClick={() => setCode(codeDevHint)}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg font-medium shrink-0 transition-colors cursor-pointer"
              >
                自动填入
              </button>
            </div>
          )}

          {/* TAB 1: 账号密码登录 */}
          {activeTab === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  学号 / 用户名
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={e => setLoginUsername(e.target.value)}
                    placeholder="请输入13位学号或 admin"
                    className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all font-mono"
                    required
                  />
                  <GraduationCap size={18} className="absolute left-3 top-3 text-slate-400" />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-slate-700">账户密码</label>
                  <button
                    type="button"
                    onClick={() => setActiveTab("register")}
                    className="text-xs text-blue-600 hover:underline cursor-pointer"
                  >
                    忘记密码？
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showLoginPwd ? "text" : "password"}
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    placeholder="请输入登录密码"
                    className="w-full pl-9 pr-10 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all font-mono"
                    required
                  />
                  <Lock size={18} className="absolute left-3 top-3 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setShowLoginPwd(!showLoginPwd)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showLoginPwd ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{loginLoading ? "正在验证身份..." : "立即登录系统"}</span>
                <ArrowRight size={16} weight="bold" />
              </button>

              <div className="text-center pt-2 text-xs text-slate-500">
                <span>尚未激活或忘记密码？</span>
                <button
                  type="button"
                  onClick={() => setActiveTab("register")}
                  className="text-blue-600 hover:underline font-semibold ml-1 cursor-pointer"
                >
                  验证码快速激活 / 重置
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: 首次注册 / 重置密码 */}
          {activeTab === "register" && (
            <form onSubmit={handleRegisterOrReset} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  学生学号 (仅限选课名单)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="username"
                      value={studentId}
                      onChange={e => setStudentId(e.target.value.replace(/\D/g, "").slice(0, 13))}
                      placeholder="13位学号 (如 2023302020001)"
                      className="w-full pl-9 pr-2 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                      required
                    />
                    <GraduationCap size={18} className="absolute left-3 top-3 text-slate-400" />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={sendCodeLoading || !turnstileToken || cooldownSeconds > 0}
                    className="px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold shrink-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1 min-w-[96px] whitespace-nowrap"
                  >
                    {cooldownSeconds > 0 ? (
                      <>
                        <Clock size={14} className="shrink-0" />
                        <span>{Math.floor(cooldownSeconds / 60)}分{cooldownSeconds % 60}秒</span>
                      </>
                    ) : sendCodeLoading ? (
                      "发送中..."
                    ) : (
                      "获取验证码"
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 break-words-safe leading-normal">
                  验证码直发 <strong>{studentId.trim() || "学号"}@whu.edu.cn</strong>（30分钟有效，10分钟冷却锁）
                </p>
              </div>

              {/* Turnstile 安全核验 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  安全人机核验 (通过后方可获取邮件)
                </label>
                <TurnstileWidget onVerify={setTurnstileToken} />
              </div>

              {/* 验证码与密码输入 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  6位邮箱验证码 (防暴力破解，错误超限将临时锁定)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="请输入邮件中的 6 位数字验证码"
                    maxLength={6}
                    className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono tracking-wider"
                    required
                  />
                  <EnvelopeSimple size={18} className="absolute left-3 top-3 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  设置新登录密码 (6~64位)
                </label>
                <div className="relative">
                  <input
                    type={showRegPwd ? "text" : "password"}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="请输入 6 到 64 位密码"
                    className="w-full pl-9 pr-10 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                    required
                  />
                  <Key size={18} className="absolute left-3 top-3 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setShowRegPwd(!showRegPwd)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showRegPwd ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  确认新登录密码
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPwd ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="请再次输入新密码"
                    className="w-full pl-9 pr-10 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                    required
                  />
                  <Key size={18} className="absolute left-3 top-3 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPwd(!showConfirmPwd)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showConfirmPwd ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={regLoading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{regLoading ? "正在验证并激活账户..." : "确认并自动登入系统"}</span>
                <CheckCircle size={16} weight="bold" />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Footer Branding */}
      <footer className="mt-6 text-center text-xs text-slate-500 space-y-1">
        <div className="flex items-center justify-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Cloudflare Edge Serverless 运行正常</span>
        </div>
        <p className="opacity-80">
          © 2026 通用作业自动批改系统
        </p>
      </footer>
    </div>
  );
};