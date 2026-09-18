export interface Env {
  CPHW_KV: KVNamespace;
  JWT_SECRET: string;
  COMPUTE_AUTH_TOKEN: string;
  TURNSTILE_SECRET_KEY: string;
  DEV_MOCK_EMAIL?: string;
  ALLOW_TEST_TURNSTILE?: string;
  ALLOWED_ORIGIN?: string;
  ASSETS: Fetcher;
}

export type UserRole = "student" | "admin";

export interface User {
  username: string; // studentId or "admin"
  studentId?: string;
  role: UserRole;
  passwordHash: string;
  salt: string;
  registeredAt: string;
  updatedAt: string;
  tokenVersion: number; // 令牌版本号：修改密码时自增，使旧 JWT 立即作废
  isDefaultPassword?: boolean;
}

export interface VerificationRecord {
  code: string;
  studentId: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  failedAttempts: number;
}

export interface EmailCooldownRecord {
  lastSentAt: number;
  expiresAt: number;
}

export interface Assignment {
  id: string; // e.g. "hw-1"
  week: number;
  title: string;
  overview: string;
  details: string;
  deadline?: string;
  createdAt: string;
}

export type SubmissionStatus = "queued" | "in_progress" | "graded";

export interface SubmissionMetadata {
  id: string;
  assignmentId: string;
  studentId: string;
  repoUrl: string;
  branch?: string;
  subpath?: string;
  status: SubmissionStatus;
  score: number | null;
  submittedAt: string;
  gradedAt: string | null;
}

export interface EvaluationRound {
  round: number;          // 轮次编号: 1, 2, 3...
  roundLabel: string;     // 中文轮次标识: "第一次评测", "第二次评测", "第三次评测"...
  taskId: string;
  score: number | null;
  details: string | null;
  repoUrl: string;
  branch?: string;
  subpath?: string;
  submittedAt: string;
  gradedAt: string | null;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  activeTaskId?: string; // 绑定当前正在运行的任务 ID (任务锁)
  lastTaskId?: string;   // 最近一次完成评测的任务 ID (用于网络重试幂等性核验与防篡改)
  repoUrl: string;
  branch?: string;       // 指定 Git 分支 (默认 main/master)
  subpath?: string;      // 指定代码所在子目录 (单仓多作业 monorepo)
  status: SubmissionStatus;
  score: number | null;
  details: string | null;
  submittedAt: string;
  startedAt?: string;    // 任务被计算层拉取、进入沙箱开始执行的时间戳
  gradedAt: string | null;
  currentRound?: number;            // 当前为第几次提交评测
  currentRoundLabel?: string;       // 例如 "第一次评测", "第二次评测"
  history?: EvaluationRound[];      // 先前各评价轮次归档记录 (用于迭代改进提示)
}

export interface QueueTask {
  taskId: string;
  studentId: string;
  assignmentId: string;
  assignmentTitle?: string;
  assignmentOverview?: string;
  assignmentDetails: string;
  repoUrl: string;
  branch?: string;
  subpath?: string;
  submittedAt: string;
  retryCount?: number;   // 重试计数
  currentRound?: number;            // 当前提交轮次 (1, 2, 3...)
  currentRoundLabel?: string;       // "第一次提交 (第 1 次评测)", "第二次提交 (第 2 次评测)"...
  history?: EvaluationRound[];      // 先前所有评测轮次档案
  historyPrompt?: string;           // 格式化好的 Prompt 文本块，直接供计算层 Agent 使用
}

export interface TaskLease {
  taskId: string;
  studentId: string;
  assignmentId: string;
  assignmentTitle?: string;
  assignmentOverview?: string;
  assignmentDetails: string;
  repoUrl: string;
  branch?: string;
  subpath?: string;
  submittedAt: string;
  startedAt: number;     // 毫秒时间戳
  retryCount: number;
  currentRound?: number;
  currentRoundLabel?: string;
  history?: EvaluationRound[];
  historyPrompt?: string;
}

export interface AdminAuditRecord {
  id: string;
  operator: string;
  action: "publish_assignment" | "delete_assignment" | "update_repo_config";
  target: string;
  details: string;
  ip: string;
  timestamp: string;
}

export interface JWTPayload {
  username: string;
  role: UserRole;
  tokenVersion: number;
  exp: number;
  iat?: number;
  jti?: string;
}
