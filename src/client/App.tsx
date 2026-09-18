import React, { useState, useEffect } from "react";
import { AuthView } from "./views/AuthView";
import { StudentView } from "./views/StudentView";
import { AdminView } from "./views/AdminView";

export const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("cphw_token"));
  const [user, setUser] = useState<any | null>(() => {
    try {
      const raw = localStorage.getItem("cphw_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      localStorage.removeItem("cphw_user");
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);

  // 初始化校验本地 Token 有效性
  useEffect(() => {
    const verifySession = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = (await res.json()) as any;
        if (data.success && data.user) {
          setUser(data.user);
          localStorage.setItem("cphw_user", JSON.stringify(data.user));
        } else {
          handleLogout("您的登录会话已过期，请重新登录");
        }
      } catch (err) {
        // 网络问题暂时保留本地状态
      } finally {
        setLoading(false);
      }
    };

    verifySession();
  }, [token]);

  const handleLoginSuccess = (newToken: string, newUser: any) => {
    setToken(newToken);
    setUser(newUser);
    setLogoutNotice(null);
    localStorage.setItem("cphw_token", newToken);
    localStorage.setItem("cphw_user", JSON.stringify(newUser));
  };

  const handleLogout = (reason?: string) => {
    if (token) {
      // 触发服务端作废 Token
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    if (reason) {
      setLogoutNotice(reason);
    }
    localStorage.removeItem("cphw_token");
    localStorage.removeItem("cphw_user");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center text-slate-500 text-sm">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <span>正在连接作业批改服务...</span>
        </div>
      </div>
    );
  }

  // 1. 未登录状态 -> 统一登录 / 注册 / 找回密码
  if (!token || !user) {
    return <AuthView onLoginSuccess={handleLoginSuccess} noticeMessage={logoutNotice} />;
  }

  // 2. 管理员界面
  if (user.role === "admin") {
    return <AdminView token={token} onLogout={handleLogout} />;
  }

  // 3. 学生看板
  return <StudentView token={token} user={user} onLogout={handleLogout} />;
};