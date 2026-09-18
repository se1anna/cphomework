import React, { useEffect, useRef, useState } from "react";
import { ShieldCheck, ArrowClockwise } from "@phosphor-icons/react";

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  siteKey?: string;
  theme?: "light" | "dark" | "auto";
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        params: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          theme?: string;
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({
  onVerify,
  siteKey = "1x00000000000000000000AA", // Cloudflare 官方测试 Always Pass 站点公钥
  theme = "light"
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widgetId, setWidgetId] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;

  const isDev = Boolean((import.meta as any).env?.DEV);

  useEffect(() => {
    let interval: any;
    let currentId: string | null = null;
    setLoadTimedOut(false);

    const checkTurnstile = () => {
      if (window.turnstile && containerRef.current && !currentId) {
        try {
          const id = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme,
            callback: (token: string) => {
              setVerified(true);
              onVerifyRef.current(token);
            },
            "error-callback": () => {
              console.warn("Turnstile widget encountered an error or network block.");
              setLoadTimedOut(true);
            },
            "expired-callback": () => {
              setVerified(false);
              onVerifyRef.current("");
              if (currentId && window.turnstile?.reset) {
                window.turnstile.reset(currentId);
              }
            }
          } as any);
          currentId = id;
          setWidgetId(id);
          clearInterval(interval);
        } catch (e) {
          console.error("Failed to render Turnstile widget:", e);
        }
      }
    };

    interval = setInterval(checkTurnstile, 300);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (!currentId) {
        setLoadTimedOut(true);
      }
    }, 6000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      if (currentId && window.turnstile?.remove) {
        try {
          window.turnstile.remove(currentId);
        } catch {}
      }
    };
  }, [siteKey, theme, retryKey]);

  const handleSimulatePass = () => {
    setVerified(true);
    onVerifyRef.current("test-turnstile-pass");
  };

  const handleRetryLoad = () => {
    setLoadTimedOut(false);
    setRetryKey(k => k + 1);
  };

  return (
    <div className="my-3 flex flex-col items-center justify-center p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
      <div className="flex items-center gap-2 mb-2 text-slate-700 font-medium">
        <ShieldCheck size={20} className="text-blue-600" />
        <span>Cloudflare 安全人机核验</span>
      </div>

      <div ref={containerRef} className="min-h-[65px] flex items-center justify-center" />

      {loadTimedOut && !widgetId && !verified && (
        <div className="mt-2 text-center text-xs text-amber-600">
          <p>人机核验组件加载较慢（可能受校园网出口波动影响）</p>
          <button
            type="button"
            onClick={handleRetryLoad}
            className="mt-1 inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer"
          >
            <ArrowClockwise size={13} />
            <span>重新加载核验组件</span>
          </button>
        </div>
      )}

      {verified && (
        <div className="text-xs text-emerald-600 font-medium mt-1 flex items-center gap-1">
          人机核验已通过
        </div>
      )}

      {/* 本地测试/无外网开发环境下的快捷测试兜底 */}
      {!verified && isDev && (
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={handleSimulatePass}
            className="text-xs text-blue-600 hover:text-blue-800 underline flex items-center gap-1 mx-auto cursor-pointer"
          >
            <span>[本地开发] 模拟通过人机验证</span>
          </button>
        </div>
      )}
    </div>
  );
};
