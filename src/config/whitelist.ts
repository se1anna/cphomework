/**
 * 课程学生学号白名单
 * 未在此名单内的学号无法注册与发送验证码
 */

export const STUDENT_WHITELIST: readonly string[] = [
  // 学生学号白名单示例 (13位数字)
  "2023302020001",
  "2023302020002",
  "2023302020003",
  "2023302020004",
  "2023302020005",
  "2023302020006",
  "2023302020007",
  "2023302020008",
  "2023302020009",
  "2023302020010",
  "2023302020011",
  "2023302020012",
  "2023302020013",
  "2023302020014",
  "2023302020015",
  "2023302020016",
  "2023302020017",
  "2023302020018",
  "2023302020019",
  "2023302020020",
  "2023302020021",
  "2023302020022",
  "2023302020023",
  "2023302020024",
  "2023302020025",
  "2023302020026",
  "2023302020027",
  "2023302020028",
  "2023302020029",
  "2023302020030",
  "2023302020031",
  "2023302020032",
  "2023302020033",
  "2023302020034",
  "2023302020035",
  "2023302020036",
  "2023302020037",
  "2023302020038",
  "2023302020039",
  "2023302020040"
];

const whitelistSet = new Set<string>(STUDENT_WHITELIST);

/** 格式规范核验：严格要求 13 位纯数字格式 (杜绝特殊字符、换行与伪造编码) */
export function isValidStudentIdFormat(studentId: string): boolean {
  if (!studentId || typeof studentId !== "string") return false;
  return /^\d{13}$/.test(studentId.trim());
}

/** 校验学号是否存在于白名单中 (兼顾格式与名单匹配) */
export function isStudentInWhitelist(studentId: string): boolean {
  if (!isValidStudentIdFormat(studentId)) return false;
  return whitelistSet.has(studentId.trim());
}

/** 获取所有白名单学号列表 */
export function getAllWhitelistStudents(): string[] {
  return [...STUDENT_WHITELIST];
}
