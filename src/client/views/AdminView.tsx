import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  SignOut,
  Key,
  PlusCircle,
  Trash,
  Users,
  CheckSquare,
  Queue,
  BookOpen,
  Copy,
  Check,
  Gear,
  X,
  ArrowSquareOut,
  FileText,
  CheckCircle,
  Clock
} from "@phosphor-icons/react";
import { PasswordModal } from "../components/PasswordModal";
import { copyToClipboard } from "../utils/clipboard";

interface AdminViewProps {
  token: string;
  onLogout: (reason?: string) => void;
}

interface OverviewData {
  metrics: {
    whitelistCount: number;
    registeredCount: number;
    queueLength: number;
    assignmentCount: number;
  };
  assignmentStats: Array<{
    id: string;
    week: number;
    title: string;
    submittedCount: number;
    registeredCount: number;
    whitelistCount: number;
    completionRateRegistered: number;
    completionRateWhitelist: number;
    avgScore: string;
  }>;
}

const isSafeHttpUrl = (urlString: string): boolean => {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

export const AdminView: React.FC<AdminViewProps> = ({ token, onLogout }) => {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"assignments" | "missing" | "config">("assignments");

  // 密码修改弹窗
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // 查看学生提交详情弹窗
  const [viewSubmissionsAssignId, setViewSubmissionsAssignId] = useState<string | null>(null);
  const [submissionsList, setSubmissionsList] = useState<any[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [selectedSubDetail, setSelectedSubDetail] = useState<any | null>(null);

  // 发布作业表单弹窗
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isDefaultPassword, setIsDefaultPassword] = useState(false);
  const [newWeek, setNewWeek] = useState(3);
  const [newTitle, setNewTitle] = useState("");
  const [newOverview, setNewOverview] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [publishLoading, setPublishLoading] = useState(false);

  // 未交学号排查
  const [selectedAssignId, setSelectedAssignId] = useState<string>("");
  const [missingData, setMissingData] = useState<{
    submittedCount: number;
    missingFromWhitelist: string[];
    missingFromRegistered: string[];
  } | null>(null);
  const [missingLoading, setMissingLoading] = useState(false);
  type CopyFormat = "comma" | "chinese_comma" | "newline" | "notice";
  const [copyFormat, setCopyFormat] = useState<CopyFormat>("comma");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 仓库前缀配置
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [prefixInput, setPrefixInput] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  // 弹窗开启时锁定底层滚动
  const isAnyModalOpen = isPasswordModalOpen || isPublishModalOpen || !!viewSubmissionsAssignId || !!selectedSubDetail;
  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isAnyModalOpen]);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/overview", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout("您的管理员登录会话已过期，请重新登录");
        return;
      }
      const data = (await res.json()) as any;
      if (data.success) {
        setOverview(data);
        if (data.isDefaultAdminPassword) {
          setIsDefaultPassword(true);
        } else {
          setIsDefaultPassword(false);
        }
        if (data.assignmentStats?.length > 0 && !selectedAssignId) {
          setSelectedAssignId(data.assignmentStats[0].id);
        }
      }
    } catch (err) {
      console.error("Fetch admin overview failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPrefixes = async () => {
    try {
      const res = await fetch("/api/admin/config", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout("您的管理员登录会话已过期，请重新登录");
        return;
      }
      const data = (await res.json()) as any;
      if (data.success && data.prefixes) {
        setPrefixes(data.prefixes);
        setPrefixInput(data.prefixes.join(", "));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMissingStudents = async (assignId: string) => {
    if (!assignId) return;
    setMissingLoading(true);
    try {
      const res = await fetch(`/api/admin/assignments/${assignId}/missing-students`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout("您的管理员登录会话已过期，请重新登录");
        return;
      }
      const data = (await res.json()) as any;
      if (data.success) {
        setMissingData({
          submittedCount: data.submittedCount,
          missingFromWhitelist: data.missingFromWhitelist || [],
          missingFromRegistered: data.missingFromRegistered || []
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setMissingLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
    fetchPrefixes();
  }, []);

  useEffect(() => {
    if (selectedAssignId) {
      fetchMissingStudents(selectedAssignId);
    }
  }, [selectedAssignId]);

  // 发布作业
  const handlePublishAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setPublishLoading(true);
    try {
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          week: newWeek,
          title: newTitle.trim(),
          overview: newOverview.trim(),
          details: newDetails.trim()
        })
      });

      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "发布失败");
      }

      setIsPublishModalOpen(false);
      setNewTitle("");
      setNewOverview("");
      setNewDetails("");
      await fetchOverview();
    } catch (err: any) {
      alert(err.message || "发布作业失败");
    } finally {
      setPublishLoading(false);
    }
  };

  // 删除作业
  const handleDeleteAssignment = async (id: string, title: string) => {
    if (!window.confirm(`确定要删除作业「${title}」吗？此操作将同时清除相关配置。`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/assignments/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as any;
      if (data.success) {
        await fetchOverview();
      }
    } catch (err) {
      alert("删除失败");
    }
  };

  // 保存前缀配置
  const handleSavePrefixes = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigLoading(true);
    setConfigMessage(null);

    const parsed = prefixInput
      .split(",")
      .map(p => p.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ prefixes: parsed })
      });
      const data = (await res.json()) as any;
      if (data.success) {
        setPrefixes(data.prefixes);
        setConfigMessage("白名单前缀配置已生效！");
      }
    } catch (err: any) {
      alert("保存失败");
    } finally {
      setConfigLoading(false);
    }
  };

  // 查看某作业的所有学生提交列表
  const handleOpenSubmissions = async (assignId: string) => {
    setViewSubmissionsAssignId(assignId);
    setSelectedSubDetail(null);
    setSubmissionsLoading(true);
    try {
      const res = await fetch(`/api/admin/assignments/${assignId}/submissions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout("您的管理员登录会话已过期，请重新登录");
        return;
      }
      const data = (await res.json()) as any;
      if (data.success) {
        setSubmissionsList(data.submissions || []);
      }
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    } finally {
      setSubmissionsLoading(false);
    }
  };

  // 导出某作业完整成绩单 CSV
  const handleExportCsv = async (assignId: string) => {
    try {
      const res = await fetch(`/api/admin/assignments/${assignId}/export-csv`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        onLogout("您的管理员登录会话已过期，请重新登录");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `assignment_${assignId}_submissions.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Export CSV failed:", err);
      alert("导出成绩单失败，请稍后重试");
    }
  };

  // 复制未交学号 (支持英文逗号、中文逗号、换行与群催交通知模板)
  const copyMissingList = async (
    list: string[],
    key: "registered" | "whitelist",
    formatOverride?: CopyFormat
  ) => {
    if (!list || list.length === 0) return;
    const format = formatOverride || copyFormat;
    let content = "";

    const curAssign = overview?.assignmentStats.find(a => a.id === selectedAssignId);
    const assignTitle = curAssign ? `第 ${curAssign.week} 周《${curAssign.title}》` : "本次作业";

    if (format === "comma") {
      // 逗号分隔 (默认: 2023302020001, 2023302020002)
      content = list.join(", ");
    } else if (format === "chinese_comma") {
      // 中文全角逗号 (2023302020001，2023302020002)
      content = list.join("，");
    } else if (format === "newline") {
      // 换行分隔
      content = list.join("\n");
    } else if (format === "notice") {
      // 完整群催交通知文案
      const categoryDesc = key === "registered" ? "已激活账号但尚未提交" : "全班尚未提交";
      content = `【作业催交提醒】${assignTitle}${categoryDesc}的同学名单如下（共 ${list.length} 人），请尽快提交代码仓库进行自动化仿真评测：\n${list.join(", ")}`;
    } else {
      content = list.join(", ");
    }

    await copyToClipboard(content);
    setCopiedKey(`${key}_${format}`);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  return (
    <div className="min-h-screen bg-slate-50/80 pb-16">
      {/* 顶部导航 */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-xs">
              <ShieldCheck size={22} weight="duotone" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold leading-tight">
                作业自动批改 · 教学管理端
              </h1>
              <p className="text-[11px] text-slate-400">教师管理控制台</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPasswordModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
            >
              <Key size={14} />
              <span className="hidden sm:inline">修改管理员密码</span>
              <span className="sm:hidden">改密</span>
            </button>
            <button
              onClick={() => onLogout()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 hover:text-rose-100 bg-rose-950/60 hover:bg-rose-900 rounded-xl transition-colors cursor-pointer"
            >
              <SignOut size={14} />
              <span>退出</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
        {/* 弱密码安全告警横幅 */}
        {isDefaultPassword && (
          <div className="mb-6 p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs animate-pulse">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-600 text-white rounded-xl shrink-0">
                <Key size={22} weight="bold" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-rose-900">
                  【高风险安全告警】管理员账户当前仍在使用默认弱密码 (123456)
                </h4>
                <p className="text-xs text-rose-700 mt-0.5">
                  任何知晓此系统的外部人员均可轻易登录并篡改系统配置！请立即点击右侧按钮修改管理员密码。
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsPasswordModalOpen(true)}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shrink-0 transition-colors shadow-xs cursor-pointer"
            >
              立即修改密码
            </button>
          </div>
        )}

        {/* 指标大屏 */}
        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <Users size={16} className="text-blue-600" />
                <span>选课白名单人数</span>
              </div>
              <div className="text-2xl font-black text-slate-900">
                {overview.metrics.whitelistCount}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">硬编码名单全量学生</div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <CheckSquare size={16} className="text-emerald-600" />
                <span>已注册学生数</span>
              </div>
              <div className="text-2xl font-black text-slate-900">
                {overview.metrics.registeredCount}
              </div>
              <div className="text-[11px] text-emerald-600 mt-1 font-medium">
                激活率{" "}
                {Math.round(
                  (overview.metrics.registeredCount / overview.metrics.whitelistCount) * 100
                )}
                %
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <Queue size={16} className="text-amber-600" />
                <span>评测队列积压任务</span>
              </div>
              <div className="text-2xl font-black text-slate-900">
                {overview.metrics.queueLength}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">待计算层拉取处理</div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <BookOpen size={16} className="text-indigo-600" />
                <span>当前已发布作业</span>
              </div>
              <div className="text-2xl font-black text-slate-900">
                {overview.metrics.assignmentCount}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">每周仿真实验任务</div>
            </div>
          </div>
        )}

        {/* 标签栏 */}
        <div className="flex border-b border-slate-200 mb-6 gap-2">
          <button
            onClick={() => setActiveTab("assignments")}
            className={`pb-3 px-4 text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === "assignments"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            作业管理与发布
          </button>
          <button
            onClick={() => setActiveTab("missing")}
            className={`pb-3 px-4 text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === "missing"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            未交学号精准排查
          </button>
          <button
            onClick={() => setActiveTab("config")}
            className={`pb-3 px-4 text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === "config"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            仓库白名单配置
          </button>
        </div>

        {/* TAB 1: 作业管理 */}
        {activeTab === "assignments" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-800">每周作业完成度明细</h3>
              <button
                onClick={() => setIsPublishModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <PlusCircle size={17} weight="bold" />
                <span>发布新作业</span>
              </button>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600 min-w-[760px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-bold text-[11px]">
                    <tr>
                      <th className="py-3 px-4">周次</th>
                      <th className="py-3 px-4">作业标题</th>
                      <th className="py-3 px-4">完成情况 (提交/注册)</th>
                      <th className="py-3 px-4">白名单完成率</th>
                      <th className="py-3 px-4">平均得分</th>
                      <th className="py-3 px-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overview?.assignmentStats.map(item => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-indigo-700">第 {item.week} 周</td>
                        <td className="py-3.5 px-4 font-semibold text-slate-800 break-words-safe">{item.title}</td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-800">{item.submittedCount}</span>
                          <span className="text-slate-400"> / {item.registeredCount} 人</span>
                          <div className="w-24 bg-slate-100 h-1.5 rounded-full mt-1 overflow-hidden">
                            <div
                              className="bg-blue-600 h-full rounded-full"
                              style={{ width: `${Math.min(100, item.completionRateRegistered)}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-medium">
                          {item.completionRateWhitelist}%
                        </td>
                        <td className="py-3.5 px-4 font-bold text-emerald-600">
                          {item.avgScore !== "-" ? `${item.avgScore} 分` : "-"}
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handleOpenSubmissions(item.id)}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-semibold transition-colors cursor-pointer"
                          >
                            查看提交 ({item.submittedCount})
                          </button>
                          <button
                            onClick={() => {
                              setSelectedAssignId(item.id);
                              setActiveTab("missing");
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors cursor-pointer"
                          >
                            排查未交
                          </button>
                          <button
                            onClick={() => handleExportCsv(item.id)}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg font-semibold transition-colors cursor-pointer"
                            title="导出该次作业全部提交成绩单 CSV"
                          >
                            导出成绩单
                          </button>
                          <button
                            onClick={() => handleDeleteAssignment(item.id, item.title)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="删除作业"
                          >
                            <Trash size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 未交学号排查 (可以看到具体是哪个学号没完成作业) */}
        {activeTab === "missing" && (
          <div className="space-y-5">
            <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/90 shadow-xs">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* 选择排查的作业 */}
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-bold text-slate-800 mb-1.5">
                    选择排查的作业
                  </label>
                  <select
                    value={selectedAssignId}
                    onChange={e => setSelectedAssignId(e.target.value)}
                    className="w-full max-w-md px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer shadow-2xs"
                  >
                    {overview?.assignmentStats.map(a => (
                      <option key={a.id} value={a.id}>
                        第 {a.week} 周：{a.title}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 复制格式配置切换 */}
                <div className="shrink-0 flex flex-col sm:items-end">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-bold text-slate-800">一键复制格式</span>
                    <span className="text-[11px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 font-mono">
                      {copyFormat === "comma" && "分隔符: 英文逗号+空格"}
                      {copyFormat === "chinese_comma" && "分隔符: 中文全角逗号"}
                      {copyFormat === "newline" && "分隔符: 换行回车"}
                      {copyFormat === "notice" && "格式: 群催交通知文案"}
                    </span>
                  </div>
                  <div className="inline-flex flex-wrap p-1 bg-slate-100/90 rounded-2xl gap-1 text-xs border border-slate-200/60">
                    <button
                      type="button"
                      onClick={() => setCopyFormat("comma")}
                      className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                        copyFormat === "comma"
                          ? "bg-white text-blue-700 shadow-xs font-bold"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                      }`}
                    >
                      逗号分隔 (推荐)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCopyFormat("chinese_comma")}
                      className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                        copyFormat === "chinese_comma"
                          ? "bg-white text-blue-700 shadow-xs font-bold"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                      }`}
                    >
                      中文逗号
                    </button>
                    <button
                      type="button"
                      onClick={() => setCopyFormat("newline")}
                      className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                        copyFormat === "newline"
                          ? "bg-white text-blue-700 shadow-xs font-bold"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                      }`}
                    >
                      换行分隔
                    </button>
                    <button
                      type="button"
                      onClick={() => setCopyFormat("notice")}
                      className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                        copyFormat === "notice"
                          ? "bg-white text-indigo-700 shadow-xs font-bold"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                      }`}
                    >
                      催交通知模板
                    </button>
                  </div>
                </div>
              </div>

              {/* 格式效果预览 */}
              <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0 font-medium">当前复制格式效果：</span>
                  <span className="font-mono text-slate-700 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-200/60 truncate max-w-md sm:max-w-xl">
                    {copyFormat === "comma" && "2023302020001, 2023302020002, 2023302020003"}
                    {copyFormat === "chinese_comma" && "2023302020001，2023302020002，2023302020003"}
                    {copyFormat === "newline" && "2023302020001 [换行] 2023302020002 [换行] 2023302020003"}
                    {copyFormat === "notice" && "【作业催交提醒】第 X 周尚未提交的同学名单如下：2023302020001, 2023302020002..."}
                  </span>
                </div>
                <span className="text-slate-400 hidden sm:inline">点击卡片右上角按钮即可一键复制到剪贴板</span>
              </div>
            </div>

            {missingLoading && (
              <div className="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200/90">
                正在比对全量白名单与提交索引...
              </div>
            )}

            {!missingLoading && missingData && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 已注册但尚未提交 */}
                <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        已激活账号但未提交 ({missingData.missingFromRegistered.length} 人)
                      </h4>
                      <p className="text-[11px] text-slate-500">已登录系统但尚未推入 Git 评测仓库</p>
                    </div>
                    <button
                      onClick={() => copyMissingList(missingData.missingFromRegistered, "registered")}
                      disabled={missingData.missingFromRegistered.length === 0}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed ${
                        copiedKey?.startsWith("registered")
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-blue-600 hover:bg-blue-700 text-white"
                      }`}
                    >
                      {copiedKey?.startsWith("registered") ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                      <span>
                        {copiedKey?.startsWith("registered")
                          ? "已复制 (含逗号)"
                          : copyFormat === "comma"
                          ? "一键复制 (逗号分隔)"
                          : copyFormat === "chinese_comma"
                          ? "一键复制 (中文逗号)"
                          : copyFormat === "newline"
                          ? "一键复制 (换行)"
                          : "一键复制催交通知"}
                      </span>
                    </button>
                  </div>

                  <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/70 max-h-80 overflow-y-auto font-mono text-xs text-slate-700 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
                    {missingData.missingFromRegistered.map(sid => (
                      <span key={sid} className="px-2 py-1 bg-white border border-slate-200 rounded-lg shadow-2xs">
                        {sid}
                      </span>
                    ))}
                    {missingData.missingFromRegistered.length === 0 && (
                      <div className="col-span-full text-center text-emerald-600 py-6 font-sans">
                        所有已激活学生均已提交该作业。
                      </div>
                    )}
                  </div>
                </div>

                {/* 选课白名单中所有未交 */}
                <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        白名单全量未提交 ({missingData.missingFromWhitelist.length} 人)
                      </h4>
                      <p className="text-[11px] text-slate-500">包含尚未注册激活的选课学生学号</p>
                    </div>
                    <button
                      onClick={() => copyMissingList(missingData.missingFromWhitelist, "whitelist")}
                      disabled={missingData.missingFromWhitelist.length === 0}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed ${
                        copiedKey?.startsWith("whitelist")
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-indigo-600 hover:bg-indigo-700 text-white"
                      }`}
                    >
                      {copiedKey?.startsWith("whitelist") ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                      <span>
                        {copiedKey?.startsWith("whitelist")
                          ? "已复制 (含逗号)"
                          : copyFormat === "comma"
                          ? "一键复制 (逗号分隔)"
                          : copyFormat === "chinese_comma"
                          ? "一键复制 (中文逗号)"
                          : copyFormat === "newline"
                          ? "一键复制 (换行)"
                          : "一键复制催交通知"}
                      </span>
                    </button>
                  </div>

                  <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/70 max-h-80 overflow-y-auto font-mono text-xs text-slate-700 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
                    {missingData.missingFromWhitelist.map(sid => (
                      <span key={sid} className="px-2 py-1 bg-white border border-slate-200 rounded-lg shadow-2xs">
                        {sid}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: 仓库前缀配置 */}
        {activeTab === "config" && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs max-w-2xl">
            <h3 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
              <Gear size={18} className="text-blue-600" />
              <span>Git 仓库提交地址白名单前缀</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              设置学生提交代码时允许的 Git 平台地址前缀（支持多个，英文逗号分隔）
            </p>

            {configMessage && (
              <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 rounded-xl text-xs">
                {configMessage}
              </div>
            )}

            <form onSubmit={handleSavePrefixes} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  允许的 URL 前缀列表 (逗号隔开)
                </label>
                <textarea
                  value={prefixInput}
                  onChange={e => setPrefixInput(e.target.value)}
                  rows={3}
                  placeholder="https://github.com/, https://gitee.com/"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-2">
                {prefixes.map(p => (
                  <span key={p} className="px-2.5 py-1 bg-slate-100 rounded-lg text-xs font-mono text-slate-600">
                    {p}
                  </span>
                ))}
              </div>

              <button
                type="submit"
                disabled={configLoading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {configLoading ? "保存中..." : "保存白名单配置"}
              </button>
            </form>
          </div>
        )}
      </main>

      {/* 发布新作业弹窗 */}
      {isPublishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col border border-slate-200 overflow-hidden my-auto animate-in fade-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2">
                <PlusCircle size={20} className="text-blue-600" weight="bold" />
                <h3 className="font-bold text-base text-slate-900">发布新作业</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPublishModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handlePublishAssignment} className="overflow-y-auto p-5 space-y-3.5 flex-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">周次 (周数)</label>
                <input
                  type="number"
                  value={newWeek}
                  onChange={e => setNewWeek(Number(e.target.value))}
                  min={1}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">作业标题</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="例如: 第三周：算法实现与综合测试"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">作业简介 (卡片概览)</label>
                <textarea
                  value={newOverview}
                  onChange={e => setNewOverview(e.target.value)}
                  rows={2}
                  placeholder="简要概括作业背景与核心要求"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  作业详情与评测要求说明 (展开可见)
                </label>
                <textarea
                  value={newDetails}
                  onChange={e => setNewDetails(e.target.value)}
                  rows={4}
                  placeholder="详细列出输入输出规范、测试点及评分要求等，供计算层评测"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPublishModalOpen(false)}
                  className="flex-1 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={publishLoading}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {publishLoading ? "发布中..." : "确认发布"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 查看某作业的学生提交明细弹窗 */}
      {viewSubmissionsAssignId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col border border-slate-200 overflow-hidden my-auto animate-in fade-in">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                  <CheckSquare size={20} weight="bold" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    学生提交列表与批改详情 ({viewSubmissionsAssignId})
                  </h3>
                  <p className="text-xs text-slate-500">共检索到 {submissionsList.length} 份提交记录</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setViewSubmissionsAssignId(null);
                  setSelectedSubDetail(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-5 flex-1 space-y-4">
              {submissionsLoading ? (
                <div className="p-12 text-center text-slate-400 text-xs">正在加载学生提交记录...</div>
              ) : submissionsList.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">当前作业暂无任何学生提交</div>
              ) : (
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600 min-w-[560px]">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-[11px] uppercase">
                        <tr>
                          <th className="py-2.5 px-3.5">学号</th>
                          <th className="py-2.5 px-3.5">得分</th>
                          <th className="py-2.5 px-3.5">代码仓库</th>
                          <th className="py-2.5 px-3.5">状态</th>
                          <th className="py-2.5 px-3.5">提交时间</th>
                          <th className="py-2.5 px-3.5 text-right">批改日志</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {submissionsList.map(sub => (
                          <tr key={sub.id} className="hover:bg-slate-50/80">
                            <td className="py-2.5 px-3.5 font-bold font-mono text-slate-800">{sub.studentId}</td>
                            <td className="py-2.5 px-3.5 font-bold font-mono">
                              {sub.score !== null ? (
                                <span className={sub.score >= 90 ? "text-emerald-600" : sub.score >= 60 ? "text-blue-600" : "text-rose-600"}>
                                  {sub.score} 分
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5 font-mono text-[11px] max-w-[180px] truncate">
                              {isSafeHttpUrl(sub.repoUrl) ? (
                                <a
                                  href={sub.repoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-1 truncate"
                                >
                                  <span className="truncate">{sub.repoUrl}</span>
                                  <ArrowSquareOut size={12} className="shrink-0" />
                                </a>
                              ) : (
                                <span className="text-slate-400 flex items-center gap-1 truncate" title="链接协议不安全已禁用跳转">
                                  <span className="truncate">{sub.repoUrl}</span>
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                sub.status === "graded" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                                sub.status === "in_progress" ? "bg-blue-50 text-blue-700 border border-blue-200" :
                                "bg-amber-50 text-amber-700 border border-amber-200"
                              }`}>
                                {sub.status === "graded" ? "已出分" : sub.status === "in_progress" ? "评测中" : "排队中"}
                              </span>
                            </td>
                            <td className="py-2.5 px-3.5 text-[11px] text-slate-400">
                              {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString("zh-CN") : "-"}
                            </td>
                            <td className="py-2.5 px-3.5 text-right">
                              <button
                                type="button"
                                onClick={() => setSelectedSubDetail(selectedSubDetail?.id === sub.id ? null : sub)}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer"
                              >
                                {selectedSubDetail?.id === sub.id ? "收起日志" : "查看日志"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 选中单条报告展开 */}
              {selectedSubDetail && (
                <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-2 text-slate-100 animate-in fade-in">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-300 pb-2 border-b border-slate-800">
                    <span className="flex items-center gap-1.5">
                      <FileText size={15} className="text-emerald-400" />
                      <span>学号 {selectedSubDetail.studentId} 自动化沙箱评测日志</span>
                    </span>
                    <span className="text-emerald-400 font-mono text-xs">
                      得分: {selectedSubDetail.score !== null ? `${selectedSubDetail.score} / 100` : "未评定"}
                    </span>
                  </div>
                  <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words-safe max-h-56 overflow-y-auto leading-relaxed p-2 bg-black/30 rounded-xl">
                    {selectedSubDetail.details || "无详细日志"}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setViewSubmissionsAssignId(null);
                  setSelectedSubDetail(null);
                }}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

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