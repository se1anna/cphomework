import React, { useState, useEffect } from "react";
import {
  GraduationCap,
  SignOut,
  Key,
  ArrowClockwise,
  GitBranch,
  CaretDown,
  CaretUp,
  CheckCircle,
  Clock,
  CircleNotch,
  WarningCircle,
  FileCode,
  Calendar,
  Sparkle,
  Copy,
  Check,
  HourglassHigh
} from "@phosphor-icons/react";
import { PasswordModal } from "../components/PasswordModal";
import { copyToClipboard } from "../utils/clipboard";

interface StudentViewProps {
  token: string;
  user: {
    username: string;
    studentId?: string;
    role: string;
  };
  onLogout: (reason?: string) => void;
}

interface EvaluationRoundItem {
  round: number;
  roundLabel: string;
  score: number | null;
  details: string | null;
  repoUrl: string;
  branch?: string;
  subpath?: string;
  submittedAt: string;
  gradedAt: string | null;
}

interface AssignmentItem {
  id: string;
  week: number;
  title: string;
  overview: string;
  details: string;
  deadline?: string;
  submission: {
    status: "not_submitted" | "queued" | "in_progress" | "graded";
    repoUrl: string;
    score: number | null;
    details: string | null;
    submittedAt: string | null;
    gradedAt: string | null;
    currentRound?: number;
    currentRoundLabel?: string;
    history?: EvaluationRoundItem[];
  };
}

export const StudentView: React.FC<StudentViewProps> = ({ token, user, onLogout }) => {
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [allowedPrefixes, setAllowedPrefixes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [repoInputs, setRepoInputs] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<{ id: string; text: string; isError?: boolean } | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [copiedDetailsId, setCopiedDetailsId] = useState<string | null>(null);

  const studentId = user.studentId || user.username;
  const studentEmail = `${studentId}@whu.edu.cn`;

  // 弹窗开启时锁定底层滚动
  useEffect(() => {
    if (isPasswordModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isPasswordModalOpen]);

  const fetchAssignments = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/student/assignments", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout("您的登录会话已过期，请重新登录");
        return;
      }
      const data = (await res.json()) as any;
      if (data.success) {
        setAssignments(data.assignments);
        setAllowedPrefixes(data.allowedPrefixes || []);

        // 初始化仓库地址输入框
        const initialInputs: Record<string, string> = {};
        data.assignments.forEach((a: AssignmentItem) => {
          if (a.submission?.repoUrl) {
            initialInputs[a.id] = a.submission.repoUrl;
          }
        });
        setRepoInputs(prev => ({ ...initialInputs, ...prev }));
      } else {
        setFetchError(data.error || "获取作业数据失败");
      }
    } catch (err) {
      console.error("Failed to fetch assignments:", err);
      setFetchError("获取作业列表失败，请检查网络连接或稍后重试");
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, []);

  useEffect(() => {
    // 仅当存在排队中 (queued) 或评测中 (in_progress) 任务时才启动 10 秒轮询，避免死循环消耗请求
    const hasPendingTasks = assignments.some(
      a => a.submission?.status === "queued" || a.submission?.status === "in_progress"
    );
    if (!hasPendingTasks) return;

    const timer = setInterval(() => {
      fetchAssignments();
    }, 10000);

    return () => clearInterval(timer);
  }, [assignments]);

  const handleCopyDetails = async (id: string, text: string) => {
    await copyToClipboard(text);
    setCopiedDetailsId(id);
    setTimeout(() => setCopiedDetailsId(null), 2000);
  };

  const handlePrefixClick = (assignId: string, prefix: string) => {
    const current = repoInputs[assignId] || "";
    if (!current) {
      setRepoInputs(prev => ({ ...prev, [assignId]: prefix }));
    }
  };

  const handleSubmitRepo = async (assignmentId: string) => {
    setSubmitMessage(null);

    const repoUrl = repoInputs[assignmentId]?.trim();
    if (!repoUrl) {
      setSubmitMessage({ id: assignmentId, text: "请输入代码仓库地址后再提交", isError: true });
      return;
    }

    setSubmittingId(assignmentId);
    try {
      const res = await fetch("/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ assignmentId, repoUrl })
      });

      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "提交失败");
      }

      setSubmitMessage({
        id: assignmentId,
        text: "作业已成功推入评测队列！计算层正在提取代码...",
        isError: false
      });
      await fetchAssignments();
    } catch (err: any) {
      setSubmitMessage({
        id: assignmentId,
        text: err.message || "提交失败",
        isError: true
      });
    } finally {
      setSubmittingId(null);
    }
  };

  // 统计概览
  const submittedCount = assignments.filter(a => a.submission?.status !== "not_submitted").length;
  const gradedCount = assignments.filter(a => a.submission?.status === "graded").length;

  return (
    <div className="min-h-screen bg-slate-50/80 pb-16">
      {/* 顶部导航 */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/90 sticky top-0 z-30 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-blue-700 to-indigo-600 text-white rounded-xl shadow-xs">
              <GraduationCap size={22} weight="duotone" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-slate-800 leading-tight">
                作业自动批改 · 学生端
              </h1>
              <p className="text-[11px] text-slate-500">学生作业控制台</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => fetchAssignments(true)}
              disabled={refreshing}
              title="刷新作业与评测状态"
              className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              <ArrowClockwise size={18} className={refreshing ? "animate-spin text-blue-600" : ""} />
            </button>
            <button
              onClick={() => setIsPasswordModalOpen(true)}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <Key size={14} />
              <span className="hidden sm:inline">修改密码</span>
              <span className="sm:hidden">改密</span>
            </button>
            <button
              onClick={() => onLogout()}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer"
            >
              <SignOut size={14} />
              <span>退出</span>
            </button>
          </div>
        </div>
      </header>

      {/* 主体内容 */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        {/* 学生信息与进度看板 */}
        <div className="bg-gradient-to-br from-[#0c2340] via-[#16325c] to-[#0f172a] rounded-3xl text-white p-6 sm:p-7 shadow-lg shadow-slate-300/40 mb-7 relative overflow-hidden">
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -left-12 -bottom-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-5 relative z-10">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 rounded-full text-xs font-medium backdrop-blur-md mb-2 border border-white/15">
                <Sparkle size={13} className="text-amber-300" />
                <span>课程作业 · 2026 春季学期</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">
                欢迎同学，学号：<span className="font-mono">{studentId}</span>
              </h2>
              <p className="text-xs text-sky-200/90 mt-1.5 break-words-safe">
                已绑定邮箱：<span className="font-mono underline decoration-sky-400/50">{studentEmail}</span> · 代码评测报告实时同步
              </p>
            </div>

            {/* 统计指标 */}
            <div className="grid grid-cols-3 gap-2 w-full lg:w-auto bg-white/10 backdrop-blur-md rounded-2xl p-3 border border-white/20 divide-x divide-white/10">
              <div className="text-center px-3">
                <div className="text-[11px] text-sky-200">总作业数</div>
                <div className="text-xl font-bold font-mono">{assignments.length}</div>
              </div>
              <div className="text-center px-3">
                <div className="text-[11px] text-sky-200">已提交</div>
                <div className="text-xl font-bold font-mono">{submittedCount}</div>
              </div>
              <div className="text-center px-3">
                <div className="text-[11px] text-sky-200">已出分</div>
                <div className="text-xl font-bold font-mono text-emerald-300">{gradedCount}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 每周作业列表卡片 */}
        <div className="space-y-5">
          <div className="flex items-center justify-between mb-1 px-1">
            <h3 className="text-base sm:text-lg font-bold text-slate-900">课程每周数值仿真与编程作业</h3>
            <span className="text-xs text-slate-500">点击卡片展开详情并提交 Git 仓库</span>
          </div>

          {loading && (
            <div className="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200/80 shadow-xs">
              <CircleNotch size={32} className="animate-spin mx-auto text-blue-600 mb-3" />
              <p className="text-xs font-medium">正在拉取作业配置与评测队列数据...</p>
            </div>
          )}

          {!loading && fetchError && assignments.length === 0 && (
            <div className="p-12 text-center text-rose-600 bg-rose-50/50 rounded-3xl border border-rose-200/80 shadow-xs">
              <WarningCircle size={36} className="mx-auto text-rose-500 mb-2" />
              <p className="text-xs font-semibold mb-3">{fetchError}</p>
              <button
                type="button"
                onClick={() => fetchAssignments(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-rose-200 text-rose-700 text-xs font-medium rounded-xl hover:bg-rose-50 cursor-pointer shadow-xs transition-colors"
              >
                <ArrowClockwise size={14} />
                <span>重新加载作业列表</span>
              </button>
            </div>
          )}

          {!loading && !fetchError && assignments.length === 0 && (
            <div className="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200/80 shadow-xs">
              暂无已发布的作业任务
            </div>
          )}

          {assignments.map(item => {
            const isExpanded = expandedId === item.id;
            const sub = item.submission;
            const isGraded = sub?.status === "graded";
            const isQueued = sub?.status === "queued";
            const isInProgress = sub?.status === "in_progress";

            return (
              <div
                key={item.id}
                className="bg-white rounded-3xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all overflow-hidden"
              >
                {/* 卡片头部 */}
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-xl shrink-0 border border-indigo-100">
                        第 {item.week} 周
                      </span>
                      <h4 className="text-sm sm:text-base font-bold text-slate-900 break-words-safe leading-snug">
                        {item.title}
                      </h4>
                    </div>

                    {/* 状态徽章 */}
                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                      {isGraded && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold font-mono">
                          <CheckCircle size={15} weight="fill" />
                          <span>得分: {sub.score} / 100</span>
                        </span>
                      )}
                      {isQueued && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-semibold">
                          <Clock size={15} />
                          <span>任务排队中</span>
                        </span>
                      )}
                      {isInProgress && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-semibold">
                          <CircleNotch size={15} className="animate-spin" />
                          <span>沙箱评测中</span>
                        </span>
                      )}
                      {sub?.status === "not_submitted" && (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">
                          未提交
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 简介 */}
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-3 break-words-safe">
                    {item.overview}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5 text-indigo-600 bg-indigo-50/60 px-2.5 py-1 rounded-lg border border-indigo-100/80">
                      <Sparkle size={13} className="text-indigo-500" />
                      <span className="text-[11px] font-medium">全天候开放 · 支持随时提交与多次迭代提分</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold cursor-pointer py-1"
                    >
                      <span>{isExpanded ? "收起作业详情" : "展开作业详情与提交"}</span>
                      {isExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* 展开区域 (作业详情 + 仓库地址提交 + 批改报告) */}
                {isExpanded && (
                  <div className="bg-slate-50/70 border-t border-slate-200 p-5 sm:p-6 space-y-5">
                    {/* 作业详情说明 */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <FileCode size={16} className="text-blue-600" />
                          <span>作业算法要求与评测说明</span>
                        </h5>
                        <button
                          type="button"
                          onClick={() => handleCopyDetails(item.id, item.details)}
                          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-600 cursor-pointer"
                        >
                          {copiedDetailsId === item.id ? (
                            <>
                              <Check size={13} className="text-emerald-600" />
                              <span className="text-emerald-600">已复制要求</span>
                            </>
                          ) : (
                            <>
                              <Copy size={13} />
                              <span>复制要求</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 text-xs text-slate-700 whitespace-pre-wrap break-words-safe leading-relaxed font-mono">
                        {item.details || "暂无特别说明，请严格按照课堂讲授算法实现。"}
                      </div>
                    </div>

                    {/* 仓库地址提交框 */}
                    <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <label className="block text-xs font-bold text-slate-800">
                          提交代码仓库地址 (Git Repository URL)
                        </label>
                      </div>

                      <p className="text-[11px] text-slate-500 mb-2.5">
                        点击可快捷填入白名单前缀：
                        {allowedPrefixes.map(p => (
                          <button
                            type="button"
                            key={p}
                            onClick={() => handlePrefixClick(item.id, p)}
                            className="mx-1 px-2 py-0.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 rounded-md text-blue-600 font-mono transition-colors cursor-pointer text-[11px] border border-slate-200/60"
                          >
                            {p}
                          </button>
                        ))}
                      </p>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1 min-w-0">
                          <input
                            type="url"
                            value={repoInputs[item.id] || ""}
                            onChange={e =>
                              setRepoInputs({ ...repoInputs, [item.id]: e.target.value })
                            }
                            placeholder="例如: https://github.com/your-username/cphw-simpson"
                            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono disabled:bg-slate-100 disabled:cursor-not-allowed"
                          />
                          <GitBranch size={16} className="absolute left-3 top-2.5 text-slate-400" />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSubmitRepo(item.id)}
                          disabled={submittingId === item.id}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                        >
                          {submittingId === item.id
                            ? "推入队列中..."
                            : sub?.status !== "not_submitted"
                            ? "更新提交版本"
                            : "提交开始评测"}
                        </button>
                      </div>

                      {submitMessage && submitMessage.id === item.id && (
                        <div
                          className={`mt-2.5 p-3 rounded-xl text-xs flex items-start gap-2 break-words-safe ${
                            submitMessage.isError
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          {submitMessage.isError ? (
                            <WarningCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
                          ) : (
                            <CheckCircle size={16} className="shrink-0 mt-0.5 text-emerald-600" />
                          )}
                          <span>{submitMessage.text}</span>
                        </div>
                      )}

                      {sub?.submittedAt && (
                        <div className="mt-2.5 text-[11px] text-slate-400 flex items-center gap-1">
                          <Clock size={13} />
                          <span>最近提交时间: {new Date(sub.submittedAt).toLocaleString("zh-CN")}</span>
                        </div>
                      )}
                    </div>

                    {/* 评测报告与批改详情 (终端风格高保真渲染) */}
                    {isGraded && (
                      <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800 shadow-inner space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                            <h5 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                              <span>计算层自动化沙箱批改报告</span>
                              {sub.currentRoundLabel && (
                                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded text-[10px] font-semibold">
                                  {sub.currentRoundLabel}
                                </span>
                              )}
                            </h5>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">评测结果：</span>
                            <span
                              className={`px-2.5 py-0.5 rounded-md text-xs font-black font-mono ${
                                (sub.score || 0) >= 90
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : (sub.score || 0) >= 80
                                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                                  : (sub.score || 0) >= 60
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                  : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                              }`}
                            >
                              得分 {sub.score} / 100
                            </span>
                          </div>
                        </div>

                        <div className="bg-black/40 p-4 rounded-xl border border-slate-800 text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words-safe overflow-x-auto leading-relaxed max-h-72">
                          {sub.details || "无编译执行日志"}
                        </div>

                        {sub.gradedAt && (
                          <div className="text-[11px] text-slate-500 text-right">
                            评测写回时间：{new Date(sub.gradedAt).toLocaleString("zh-CN")}
                          </div>
                        )}

                        {/* 历史评价轮次记录折叠面板 */}
                        {sub.history && sub.history.length > 1 && (
                          <div className="mt-3 pt-3 border-t border-slate-800/80">
                            <details className="group text-xs">
                              <summary className="text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-between py-1 select-none">
                                <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                                  <span>历史评价轮次记录与改进轨迹 (共 {sub.history.length} 次评测)</span>
                                </span>
                                <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                              </summary>
                              <div className="mt-2.5 space-y-2.5">
                                {sub.history.map((h, idx) => (
                                  <div key={idx} className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/90 text-[11px]">
                                    <div className="flex items-center justify-between text-slate-300 mb-1 font-mono">
                                      <span className="font-bold text-blue-400">{h.roundLabel || `第 ${h.round} 次评测`}</span>
                                      <span className="text-emerald-400 font-bold">得分: {h.score !== null ? `${h.score}分` : "待出分"}</span>
                                    </div>
                                    <div className="text-slate-500 text-[10px] mb-1.5">
                                      评测时间: {h.gradedAt ? new Date(h.gradedAt).toLocaleString("zh-CN") : "-"}
                                    </div>
                                    <div className="text-slate-400 font-mono line-clamp-3 whitespace-pre-wrap bg-black/60 p-2 rounded-lg border border-slate-800/70">
                                      {h.details || "无记录"}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* 修改密码弹窗 */}
      <PasswordModal
        token={token}
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSuccess={() => {}}
      />
    </div>
  );
};