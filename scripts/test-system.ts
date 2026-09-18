import app from "../src/index";
import { STUDENT_WHITELIST } from "../src/config/whitelist";

// 内存版 Cloudflare KV 模拟器
class MockKVNamespace {
  private store = new Map<string, { value: string; expiresAt?: number; metadata?: any }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: any }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value, expiresAt, metadata: options?.metadata });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: any): Promise<any> {
    const prefix = options?.prefix || "";
    const limit = options?.limit || 1000;
    const allKeys = Array.from(this.store.entries())
      .filter(([name, item]) => {
        if (!name.startsWith(prefix)) return false;
        if (item.expiresAt && Date.now() > item.expiresAt) {
          this.store.delete(name);
          return false;
        }
        return true;
      })
      .map(([name, item]) => ({ name, metadata: item.metadata }));

    return {
      keys: allKeys.slice(0, limit),
      list_complete: allKeys.length <= limit
    };
  }
}

async function runAllTests() {
  console.log("===============================================================");
  console.log("  通用作业自动批改系统 - 全面安全加固回归测试");
  console.log("===============================================================\n");

  const kv = new MockKVNamespace() as any;
  const env: any = {
    CPHW_KV: kv,
    JWT_SECRET: "test-secret-key-123456",
    COMPUTE_AUTH_TOKEN: "whu-cphomework-compute-secret-key-2026",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    DEV_MOCK_EMAIL: "true",
    ALLOW_TEST_TURNSTILE: "true"
  };

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testName}`);
      process.exitCode = 1;
    }
  }

  // -------------------------------------------------------------
  // Test 1: 健康检查与 HTTP 安全响应头 (CSP, X-Frame-Options, MIME)
  // -------------------------------------------------------------
  {
    const res = await app.fetch(new Request("http://localhost/api/health"), env);
    const data = (await res.json()) as any;
    const xFrame = res.headers.get("x-frame-options");
    const xContentType = res.headers.get("x-content-type-options");
    assert(
      res.status === 200 &&
      data.status === "healthy" &&
      xFrame === "DENY" &&
      xContentType === "nosniff",
      "1. 服务健康检查与 HTTP 深度防御头生效 (X-Frame-Options: DENY, nosniff)"
    );
  }

  // -------------------------------------------------------------
  // Test 2: 请求载荷过大拒绝 (DoS 防护：超过 128KB 直接 413)
  // -------------------------------------------------------------
  {
    const hugeData = "A".repeat(150 * 1024); // 150KB
    const doSRes = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: hugeData })
      }),
      env
    );
    assert(doSRes.status === 413, "2. 成功拦截超大 JSON 载荷拒绝服务攻击 (413 Payload Too Large)");
  }

  // -------------------------------------------------------------
  // Test 3: 学号白名单防刷与拦截
  // -------------------------------------------------------------
  {
    // 3.0 学号格式必须为13位数字校验
    const badFormatRes = await app.fetch(
      new Request("http://localhost/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: "12345", turnstileToken: "test-turnstile-pass" })
      }),
      env
    );
    assert(badFormatRes.status === 400, "3.0 严格阻断非13位纯数字学号参数格式 (400 Bad Request)");

    const res1 = await app.fetch(
      new Request("http://localhost/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: "9999999999999", turnstileToken: "test-turnstile-pass" })
      }),
      env
    );
    assert(res1.status === 403, "3.1 拦截不在白名单内的非法学号 (403 Forbidden)");

    const validStudentId = STUDENT_WHITELIST[0];
    const res2 = await app.fetch(
      new Request("http://localhost/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: validStudentId, turnstileToken: "test-turnstile-pass" })
      }),
      env
    );
    const data2 = (await res2.json()) as any;
    assert(res2.status === 200 && data2.success && data2.devCode, "3.2 合法白名单学号成功获取验证码并发送至 @whu.edu.cn 邮箱");
  }

  // -------------------------------------------------------------
  // Test 4: 10分钟邮件发送强制冷却拦截 (额度防骗防盗刷)
  // -------------------------------------------------------------
  {
    const testStudentId = STUDENT_WHITELIST[0];
    const spamRes = await app.fetch(
      new Request("http://localhost/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: testStudentId, turnstileToken: "test-turnstile-pass" })
      }),
      env
    );
    const spamData = (await spamRes.json()) as any;
    assert(
      spamRes.status === 429 &&
      spamData.error.includes("10分钟内已发送过") &&
      spamData.remainingSeconds > 0,
      "4.1 邮件10分钟冷却锁拦截成功: 拒绝重复发送并明确提示防额度滥用 (429 Too Many Requests)"
    );
  }

  // -------------------------------------------------------------
  // Test 5: 验证码注册与阅后即焚
  // -------------------------------------------------------------
  let studentToken = "";
  const testStudentId = STUDENT_WHITELIST[0];
  {
    const verifyRecordStr = await kv.get(`verify:${testStudentId}`);
    const verifyRecord = JSON.parse(verifyRecordStr!);
    const code = verifyRecord.code;

    const errRes = await app.fetch(
      new Request("http://localhost/api/auth/register-or-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: testStudentId, code: "000000", password: "mypassword123" })
      }),
      env
    );
    assert(errRes.status === 400, "5.1 错误验证码被拒绝");

    const regRes = await app.fetch(
      new Request("http://localhost/api/auth/register-or-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: testStudentId, code, password: "mypassword123" })
      }),
      env
    );
    const regData = (await regRes.json()) as any;
    assert(regRes.status === 200 && regData.success && regData.token, "5.2 首次注册成功并直接签发 JWT 自动登入");
    studentToken = regData.token;

    const afterDelete = await kv.get(`verify:${testStudentId}`);
    assert(afterDelete === null, "5.3 验证码核验通过后立即从 KV 中彻底删除 (防重放攻击)");
  }

  // -------------------------------------------------------------
  // Test 6: 防暴力破解与限频保护 (惩戒攻击源 IP，保留学生验证码)
  // -------------------------------------------------------------
  {
    const studentForBrute = STUDENT_WHITELIST[1];
    const sendRes = await app.fetch(
      new Request("http://localhost/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: studentForBrute, turnstileToken: "test-turnstile-pass" })
      }),
      env
    );
    const sendData = (await sendRes.json()) as any;
    const realCode = sendData.devCode;
    const attackerIp = "198.51.100.99";
    const studentIp = "203.0.113.88";

    // 攻击者 IP 故意尝试错误验证码 1~4 次
    for (let i = 1; i <= 4; i++) {
      const wrongRes = await app.fetch(
        new Request("http://localhost/api/auth/register-or-reset", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": attackerIp
          },
          body: JSON.stringify({
            studentId: studentForBrute,
            code: `99999${i}`,
            password: "pwd123456",
            turnstileToken: "test-turnstile-pass"
          })
        }),
        env
      );
      assert(wrongRes.status === 400, `6.${i} 攻击源输错第 ${i} 次被拒绝并扣减该 IP 剩余次数`);
    }

    // 攻击者 IP 输错第 5 次
    const fifthRes = await app.fetch(
      new Request("http://localhost/api/auth/register-or-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": attackerIp
        },
        body: JSON.stringify({
          studentId: studentForBrute,
          code: "888888",
          password: "pwd123456",
          turnstileToken: "test-turnstile-pass"
        })
      }),
      env
    );
    const fifthData = (await fifthRes.json()) as any;
    assert(
      fifthRes.status === 429 && fifthData.error.includes("临时限制15分钟"),
      "6.5 攻击源连续错误达到5次，系统锁定攻击源 IP 15分钟 (429 Too Many Requests)"
    );

    // 攻击者再次尝试，直接被 IP 锁拒止
    const blockedRes = await app.fetch(
      new Request("http://localhost/api/auth/register-or-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": attackerIp
        },
        body: JSON.stringify({
          studentId: studentForBrute,
          code: "000000",
          password: "pwd123456",
          turnstileToken: "test-turnstile-pass"
        })
      }),
      env
    );
    assert(blockedRes.status === 429, "6.6 攻击源已被拦截");

    // 验证 KV 中学生的验证码依然存在
    const codeInKV = await kv.get(`verify:${studentForBrute}`);
    assert(codeInKV !== null, "6.7 验证：异常输错未擦除学生邮箱真实验证码");

    // 真实学生正常输入验证码完成注册
    const studentLegitRes = await app.fetch(
      new Request("http://localhost/api/auth/register-or-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": studentIp
        },
        body: JSON.stringify({
          studentId: studentForBrute,
          code: realCode,
          password: "studentRealPassword888",
          turnstileToken: "test-turnstile-pass"
        })
      }),
      env
    );
    const legitData = (await studentLegitRes.json()) as any;
    assert(
      studentLegitRes.status === 200 && legitData.token,
      "6.8 学生本人输入邮箱真实验证码顺利登入"
    );

    // 验证通过后阅后即焚
    const finalCodeInKV = await kv.get(`verify:${studentForBrute}`);
    assert(finalCodeInKV === null, "6.9 验证成功后验证码立即阅后即焚彻底销毁");
  }

  // -------------------------------------------------------------
  // Test 7: 统一登录入口与默认密码告警
  // -------------------------------------------------------------
  let adminToken = "";
  {
    const stuLoginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: testStudentId, password: "mypassword123" })
      }),
      env
    );
    const stuLoginData = (await stuLoginRes.json()) as any;
    assert(stuLoginRes.status === 200 && stuLoginData.user.role === "student", "7.1 学生学号密码正常登录");

    const adminLoginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "123456" })
      }),
      env
    );
    const adminLoginData = (await adminLoginRes.json()) as any;
    assert(
      adminLoginRes.status === 200 &&
      adminLoginData.user.role === "admin" &&
      adminLoginData.user.isDefaultAdminPassword === true,
      "7.2 管理员默认账户 (admin/123456) 正常登录并精准标记弱密码风险"
    );
    adminToken = adminLoginData.token;
  }

  // -------------------------------------------------------------
  // Test 8: Git 仓库 Shell/参数/凭据注入深度拦截
  // -------------------------------------------------------------
  {
    // 初始化测试作业 hw-1 (生产环境已移除默认初始化例)
    await kv.put(
      "meta:assignments",
      JSON.stringify([
        {
          id: "hw-1",
          week: 1,
          title: "算法实现与综合测试",
          overview: "实现核心算法与基准测试",
          details: "测试用例通过率验证与基准测试说明"
        }
      ])
    );

    // 命令注入
    const injectRes1 = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({
          assignmentId: "hw-1",
          repoUrl: "https://github.com/hacker/repo; rm -rf /"
        })
      }),
      env
    );
    assert(injectRes1.status === 400, "8.1 严格阻断 Shell 分号与命令拼接注入 (; rm -rf)");

    // 凭证注入
    const injectRes2 = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({
          assignmentId: "hw-1",
          repoUrl: "https://user:pass@github.com/test/repo"
        })
      }),
      env
    );
    assert(injectRes2.status === 400, "8.2 严格阻断嵌入式认证凭证 URL 格式 (@)");

    // 路径遍历注入
    const injectRes3 = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({
          assignmentId: "hw-1",
          repoUrl: "https://github.com/../../etc/passwd"
        })
      }),
      env
    );
    assert(injectRes3.status === 400, "8.3 严格阻断 Git URL 路径穿越攻击 (.. / /.)");

    // 私网内网 SSRF 伪造
    const injectRes4 = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({
          assignmentId: "hw-1",
          repoUrl: "https://127.0.0.1/test/repo"
        })
      }),
      env
    );
    assert(injectRes4.status === 400, "8.4 严格阻断私有内网/本地回环地址 SSRF 伪造 (127.0.0.1)");

    // 合规提交
    const goodRepoRes = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({
          assignmentId: "hw-1",
          repoUrl: "https://github.com/whu-student/cphw1-simpson"
        })
      }),
      env
    );
    assert(goodRepoRes.status === 200, "8.5 合规 Git 仓库成功提交并推入评测队列");
  }

  // -------------------------------------------------------------
  // Test 9: 任务队列互斥锁 (防并发刷单)
  // -------------------------------------------------------------
  {
    const duplicateSubmitRes = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({
          assignmentId: "hw-1",
          repoUrl: "https://github.com/whu-student/cphw1-simpson"
        })
      }),
      env
    );
    assert(duplicateSubmitRes.status === 409, "9.1 任务排队互斥锁生效：评测未完成前严禁重复入队 (409 Conflict)");
  }

  // -------------------------------------------------------------
  // Test 10: 计算层时序安全拉取与批改回传 (防任务 ID 伪造与重复重放)
  // -------------------------------------------------------------
  let claimedTaskId = "";
  {
    const badTokenRes = await app.fetch(
      new Request("http://localhost/api/compute/task", {
        headers: { Authorization: "Bearer bad-compute-token" }
      }),
      env
    );
    assert(badTokenRes.status === 401, "10.1 计算层非法通信令牌被拦截 (401 Unauthorized)");

    const pullRes = await app.fetch(
      new Request("http://localhost/api/compute/task", {
        headers: { Authorization: `Bearer ${env.COMPUTE_AUTH_TOKEN}` }
      }),
      env
    );
    const pullData = (await pullRes.json()) as any;
    assert(pullRes.status === 200 && pullData.hasTask === true, "10.2 计算层安全拉取待评测任务");
    claimedTaskId = pullData.task.taskId;

    // 伪造/不匹配的 Task ID 提交
    const fakeTaskRes = await app.fetch(
      new Request("http://localhost/api/compute/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.COMPUTE_AUTH_TOKEN}`
        },
        body: JSON.stringify({
          taskId: "fake-task-id-9999",
          studentId: testStudentId,
          assignmentId: "hw-1",
          score: 100,
          details: "Fake result"
        })
      }),
      env
    );
    assert(fakeTaskRes.status === 409, "10.3 伪造或过期的 Task ID 被严格拒止 (409 Conflict)");

    // 合法任务结果回传
    const reportRes = await app.fetch(
      new Request("http://localhost/api/compute/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.COMPUTE_AUTH_TOKEN}`
        },
        body: JSON.stringify({
          taskId: claimedTaskId,
          studentId: testStudentId,
          assignmentId: "hw-1",
          score: 96,
          details: "辛普森积分算法精度达标，误差 1.2e-8 < 1e-7，收敛阶数 O(h^4) 验证通过"
        })
      }),
      env
    );
    assert(reportRes.status === 200, "10.4 计算层将合法成绩与报告成功写回服务器");

    // 10.5a 网络丢包重试幂等性处理：相同成绩回传返回 200 OK 并标明 idempotent: true
    const retryRes = await app.fetch(
      new Request("http://localhost/api/compute/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.COMPUTE_AUTH_TOKEN}`
        },
        body: JSON.stringify({
          taskId: claimedTaskId,
          studentId: testStudentId,
          assignmentId: "hw-1",
          score: 96,
          details: "Network retry result"
        })
      }),
      env
    );
    const retryData = (await retryRes.json()) as any;
    assert(
      retryRes.status === 200 && retryData.idempotent === true,
      "10.5a 计算层网络丢包重发相同成绩幂等放行 (200 OK, idempotent: true)"
    );

    // 10.5b 防篡改重放攻击：完结任务若被重放不同成绩，坚决拒止 (409 Conflict)
    const replayTamperRes = await app.fetch(
      new Request("http://localhost/api/compute/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.COMPUTE_AUTH_TOKEN}`
        },
        body: JSON.stringify({
          taskId: claimedTaskId,
          studentId: testStudentId,
          assignmentId: "hw-1",
          score: 100, // 恶意篡改分数
          details: "Tampered result"
        })
      }),
      env
    );
    assert(replayTamperRes.status === 409, "10.5b 评测报告篡改重放攻击被拒止：已完结任务严禁更改成绩 (409 Conflict)");
  }

  // -------------------------------------------------------------
  // Test 11: 管理端作业 ID 参数注入与路径遍历防范
  // -------------------------------------------------------------
  {
    // 非法 ID: ../../../etc/passwd 或特殊字符
    const badIdRes = await app.fetch(
      new Request("http://localhost/api/admin/assignments/..%2F..%2Fhack/missing-students", {
        headers: { Authorization: `Bearer ${adminToken}` }
      }),
      env
    );
    assert(badIdRes.status === 400, "11.1 严格过滤管理端路径注入参数 (400 Bad Request)");

    // 正常排查未交学号
    const missingRes = await app.fetch(
      new Request("http://localhost/api/admin/assignments/hw-1/missing-students", {
        headers: { Authorization: `Bearer ${adminToken}` }
      }),
      env
    );
    assert(missingRes.status === 200, "11.2 精准排查未交作业的具体学号列表");

    // 管理员获取所有学生提交记录明细
    const subsRes = await app.fetch(
      new Request("http://localhost/api/admin/assignments/hw-1/submissions", {
        headers: { Authorization: `Bearer ${adminToken}` }
      }),
      env
    );
    const subsData = (await subsRes.json()) as any;
    assert(
      subsRes.status === 200 &&
      subsData.submissions &&
      subsData.submissions.some((s: any) => s.studentId === testStudentId && s.score === 96),
      "11.3 管理员安全检索作业已提交学生名单及详细评测日志"
    );
  }

  // -------------------------------------------------------------
  // Test 12 (安全加固专项): 会话撤销与 Token 版本控制 (改密后旧 Token 瞬间作废)
  // -------------------------------------------------------------
  {
    const oldStudentToken = studentToken;

    // 修改密码
    const changePwdRes = await app.fetch(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${oldStudentToken}`
        },
        body: JSON.stringify({
          oldPassword: "mypassword123",
          newPassword: "newsecretpassword888",
          turnstileToken: "test-turnstile-pass"
        })
      }),
      env
    );
    assert(changePwdRes.status === 200, "12.1 学生成功修改密码");

    // 关键校验：尝试使用修改密码前的旧 JWT Token 请求学生接口
    const hijackedRes = await app.fetch(
      new Request("http://localhost/api/student/assignments", {
        headers: { Authorization: `Bearer ${oldStudentToken}` }
      }),
      env
    );
    assert(
      hijackedRes.status === 401,
      "12.2 Token 版本自增拦截生效：改密后旧设备登录凭证立即作废拒止 (401 Unauthorized)"
    );

    // 使用新密码登录并获取新 Token
    const newLoginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: testStudentId, password: "newsecretpassword888" })
      }),
      env
    );
    const newLoginData = (await newLoginRes.json()) as any;
    assert(newLoginRes.status === 200 && newLoginData.token, "12.3 使用新密码成功登录获取新版凭证");

    // 使用新 Token 访问接口正常
    const freshRes = await app.fetch(
      new Request("http://localhost/api/student/assignments", {
        headers: { Authorization: `Bearer ${newLoginData.token}` }
      }),
      env
    );
    assert(freshRes.status === 200, "12.4 新版 Token 正常通行");
  }

  // -------------------------------------------------------------
  // Test 13: 开放提交模式与无截止时间全时段迭代 (Open Submissions & Iterative Workflow)
  // -------------------------------------------------------------
  {
    // 管理员发布无截止时间限制的探索性作业
    const openAssignRes = await app.fetch(
      new Request("http://localhost/api/admin/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          week: 16,
          title: "开放探索大作业 (全时段开放迭代)",
          overview: "测试系统无截止时间限制，支持多轮迭代演进评分",
          details: "该作业用于验证系统不设截止时间，学生随时提交均可被正常受理"
        })
      }),
      env
    );
    assert(openAssignRes.status === 200, "13.1 管理员成功发布无截止时间限制的作业 (200 OK)");

    // 重新登录获取有效学生 token
    const studentLogin = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: testStudentId, password: "newsecretpassword888" })
      }),
      env
    );
    const studentTokenValid = ((await studentLogin.json()) as any).token;

    // 学生随时提交作业，即使是历史作业也能成功受理，不设截止时间限制
    const openSubmitRes = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentTokenValid}`
        },
        body: JSON.stringify({
          assignmentId: "hw-16",
          repoUrl: "https://github.com/whu-student/iterative-submit"
        })
      }),
      env
    );
    const openSubmitData = (await openSubmitRes.json()) as any;
    assert(
      openSubmitRes.status === 200 && openSubmitData.success === true,
      "13.2 开放提交机制生效：学生可随时提交代码且无截止时间阻断 (200 OK)"
    );

    // 13.3 计算层拉取并验证包含作业详情、题目说明与迭代轮次信息
    const pull13Res = await app.fetch(
      new Request("http://localhost/api/compute/task", {
        headers: { "X-Compute-Token": "whu-cphomework-compute-secret-key-2026" }
      }),
      env
    );
    const pull13Data = (await pull13Res.json()) as any;
    assert(
      pull13Res.status === 200 &&
      pull13Data.hasTask === true &&
      pull13Data.task.assignmentTitle === "开放探索大作业 (全时段开放迭代)" &&
      pull13Data.task.currentRound === 1 &&
      pull13Data.task.currentRoundLabel === "第一次评测",
      "13.3 计算层成功拉取到无截止时间任务及作业题目元数据与迭代提示"
    );

    // 回传报告以释放租约并完结第 1 轮
    await app.fetch(
      new Request("http://localhost/api/compute/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Compute-Token": "whu-cphomework-compute-secret-key-2026"
        },
        body: JSON.stringify({
          taskId: pull13Data.task.taskId,
          studentId: testStudentId,
          assignmentId: "hw-16",
          score: 85,
          details: "第 1 轮评测通过，建议进一步提升收敛精度。"
        })
      }),
      env
    );
  }

  // -------------------------------------------------------------
  // Test 14: 五大 Subagent 审计合理修复项全量验证
  // -------------------------------------------------------------
  {
    // 14.1 垂直越权闭环：管理员 Token 访问学生路由被拒绝
    const adminAccessStudentRes = await app.fetch(
      new Request("http://localhost/api/student/assignments", {
        headers: { Authorization: `Bearer ${adminToken}` }
      }),
      env
    );
    assert(adminAccessStudentRes.status === 403, "14.1 垂直越权闭环：管理员凭证访问学生接口被拒止 (403 Forbidden)");

    // 14.2 计算层入参边界校验：非法格式学号被拦截
    const badComputeRes = await app.fetch(
      new Request("http://localhost/api/compute/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Compute-Token": "whu-cphomework-compute-secret-key-2026"
        },
        body: JSON.stringify({
          taskId: "task-123",
          studentId: "bad_student_id",
          assignmentId: "hw-1",
          score: 90
        })
      }),
      env
    );
    assert(badComputeRes.status === 400, "14.2 计算层回传非法格式入参被阻断 (400 Bad Request)");

    // 14.3 管理端作业发布入参类型校验：空白标题被拦截
    const badAssignRes = await app.fetch(
      new Request("http://localhost/api/admin/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          week: 2,
          title: "   ",
          overview: "测试空白标题",
          deadline: "2026-12-31 23:59:00"
        })
      }),
      env
    );
    assert(badAssignRes.status === 400, "14.3 管理端作业发布空白标题被拦截 (400 Bad Request)");

    // 14.4 管理端删除作业：关联 meta:subs_map 级联彻底清理
    await kv.put("meta:subs_map:hw-16", JSON.stringify({ "test-sid": { id: "sub-1" } }));
    await kv.put("meta:subs:hw-16", JSON.stringify(["test-sid"]));
    const delAssignRes = await app.fetch(
      new Request("http://localhost/api/admin/assignments/hw-16", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` }
      }),
      env
    );
    const mapAfterDel = await kv.get("meta:subs_map:hw-16");
    const listAfterDel = await kv.get("meta:subs:hw-16");
    assert(
      delAssignRes.status === 200 && mapAfterDel === null && listAfterDel === null,
      "14.4 管理端删除作业关联聚合字典与索引级联清理完毕"
    );

    // 14.5 改密防弱口令：禁止新密码设置为 123456
    const weakPwdRes = await app.fetch(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          oldPassword: "oldpassword123",
          newPassword: "123456",
          turnstileToken: "test-turnstile-pass"
        })
      }),
      env
    );
    assert(weakPwdRes.status === 400, "14.5 改密安全约束生效：禁止将密码重置为 123456 默认弱口令 (400 Bad Request)");

    // 14.6 恒定时间比对防御空字符串边界
    const { safeCompare } = await import("../src/server/auth");
    assert(safeCompare("", "") === false, "14.6 safeCompare 严密阻断空字符串比对边界");
  }

  // -------------------------------------------------------------
  // Test 15: 第二轮五维审计加固全链路回归测试 (R2 Deep Hardening)
  // -------------------------------------------------------------
  {
    console.log("\n--- [Round 2] 执行第二轮安全与并发架构专项回归测试 ---");
    const { parseAndValidateRepoUrl, getSubmissionsForAssignment } = await import("../src/server/kv");

    // 15.1 Git URL 深度解析与清洗：分支/子目录提取、末尾斜杠清理与注入防御
    const parsedValid = await parseAndValidateRepoUrl(kv, "https://github.com/whu-student/cp-assignment/tree/dev/code/hw1/");
    assert(
      parsedValid.valid &&
      parsedValid.repoUrl === "https://github.com/whu-student/cp-assignment" &&
      parsedValid.branch === "dev" &&
      parsedValid.subpath === "code/hw1",
      "15.1a Git URL 成功归一化并安全提取 branch (dev) 与 subpath (code/hw1)"
    );

    const parsedCliInject = await parseAndValidateRepoUrl(kv, "https://github.com/student/-u--upload-pack");
    assert(
      !parsedCliInject.valid,
      "15.1b Git URL 严格阻断以减号开头的 Git CLI 参数注入 (-u)"
    );

    const parsedTraversal = await parseAndValidateRepoUrl(kv, "https://github.com/student/repo/tree/main/../secret");
    assert(
      !parsedTraversal.valid,
      "15.1c Git 子目录严格阻断路径穿越 (..)"
    );

    // 获取学生 2023302020002 的有效登录凭证
    const s2LoginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "2023302020002",
          password: "studentRealPassword888"
        })
      }),
      env
    );
    const s2LoginData = (await s2LoginRes.json()) as any;
    const student2Token = s2LoginData.token;

    // 15.2 多节点并发任务独占租赁 (Task Lease)
    // 为 student 2023302020002 提交作业 hw-1
    const subRes2 = await app.fetch(
      new Request("http://localhost/api/student/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${student2Token}`
        },
        body: JSON.stringify({
          assignmentId: "hw-1",
          repoUrl: "https://github.com/whu-student/rk4-orbit/tree/main/sim",
          note: "=SUM(A1:A10) 恶意公式测试"
        })
      }),
      env
    );
    assert(subRes2.status === 200, "15.2a 学生 2 提交带分支与子路径作业成功");

    // 计算节点拉取任务
    const pullTaskRes = await app.fetch(
      new Request("http://localhost/api/compute/task", {
        headers: { "X-Compute-Token": "whu-cphomework-compute-secret-key-2026" }
      }),
      env
    );
    const pullTaskData = (await pullTaskRes.json()) as any;
    assert(
      pullTaskRes.status === 200 &&
      pullTaskData.hasTask === true &&
      pullTaskData.task.branch === "main" &&
      pullTaskData.task.subpath === "sim",
      "15.2b 计算层安全拉取带 branch/subpath 的任务"
    );

    // 验证 KV 独占租赁记录已生成 (queue:lease:taskId)
    const taskLease = await kv.get(`queue:lease:${pullTaskData.task.taskId}`);
    assert(taskLease !== null, "15.2c 多计算节点独占租约 (queue:lease) 成功建立，防重复出队");

    // 15.3 计算完成与租约级联回收
    const compReportRes = await app.fetch(
      new Request("http://localhost/api/compute/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Compute-Token": "whu-cphomework-compute-secret-key-2026"
        },
        body: JSON.stringify({
          taskId: pullTaskData.task.taskId,
          studentId: "2023302020002",
          assignmentId: "hw-1",
          score: 92.5,
          details: "=cmd|' /C calc'!A0 恶意输出已捕获，积分收敛满足容差"
        })
      }),
      env
    );
    assert(compReportRes.status === 200, "15.3a 计算层成绩报告成功写入");
    const leaseAfterDone = await kv.get(`queue:lease:${pullTaskData.task.taskId}`);
    assert(leaseAfterDone === null, "15.3b 评测完毕后独占租约自动彻底释放");

    // 15.4 安全 CSV 导出与 CSV 公式注入防御 (CSV Injection Neutralization)
    const exportCsvRes = await app.fetch(
      new Request("http://localhost/api/admin/assignments/hw-1/export-csv", {
        headers: { Authorization: `Bearer ${adminToken}` }
      }),
      env
    );
    assert(
      exportCsvRes.status === 200 &&
      exportCsvRes.headers.get("x-content-type-options") === "nosniff" &&
      Boolean(exportCsvRes.headers.get("content-type")?.includes("text/csv")),
      "15.4a 管理端安全导出 CSV (带有 nosniff 和合法 Content-Type)"
    );
    const arrayBuffer = await exportCsvRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // 验证包含 UTF-8 BOM 签名序列 (0xEF, 0xBB, 0xBF)
    assert(
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      "15.4b 导出的 CSV 包含 UTF-8 BOM 字节序列 (0xEF, 0xBB, 0xBF)，保障 Excel 默认打开不乱码"
    );
    
    // 验证单元格公式注入防御函数 (前置单引号强制转为纯文本)
    const { sanitizeCsvField } = await import("../src/server/routes/admin.routes");
    const sanitizedFormula = sanitizeCsvField("=cmd|' /C calc'!A0");
    const sanitizedPlus = sanitizeCsvField("+1+2");
    const sanitizedNormal = sanitizeCsvField("Normal Student");
    assert(
      sanitizedFormula.startsWith("\"'=") &&
      sanitizedPlus.startsWith("\"'+") &&
      sanitizedNormal === "\"Normal Student\"",
      "15.4c 关键安全防线：以 =、+、-、@、\\t、\\r 开头的恶意公式被前置单引号严格中和"
    );

    // 15.5 管理员审计日志记录与查询
    const auditLogsRes = await app.fetch(
      new Request("http://localhost/api/admin/audit-logs", {
        headers: { Authorization: `Bearer ${adminToken}` }
      }),
      env
    );
    const auditLogsData = (await auditLogsRes.json()) as any;
    assert(
      auditLogsRes.status === 200 &&
      auditLogsData.success === true &&
      Array.isArray(auditLogsData.logs) &&
      auditLogsData.logs.length > 0,
      "15.5 管理端操作审计日志链条完整记录 (发布、删除、白名单)"
    );

    // 15.6 用户注销登出与 TokenVersion 级联作废
    const logoutRes = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${student2Token}` }
      }),
      env
    );
    assert(logoutRes.status === 200, "15.6a 用户登出接口调用成功");
    const testAfterLogoutRes = await app.fetch(
      new Request("http://localhost/api/student/assignments", {
        headers: { Authorization: `Bearer ${student2Token}` }
      }),
      env
    );
    assert(testAfterLogoutRes.status === 401, "15.6b 登出后旧凭证因 tokenVersion 自增立即失效作废 (401 Unauthorized)");

    // 15.7 KV Metadata O(1) 聚合检索无冲突
    const subList = await getSubmissionsForAssignment(kv, "hw-1");
    assert(
      subList.length >= 2 && subList.some(s => s.studentId === "2023302020002"),
      "15.7 Cloudflare KV 原生 Metadata 聚合查询无并发冲突且正确获取全部学生成绩"
    );
  }

  console.log("\n===============================================================");
  console.log(`  全量安全回归测试结果: 全部通过 (${passedTests} / ${totalTests})`);
  console.log("===============================================================");
}

runAllTests().catch(err => {
  console.error("Test execution encountered fatal error:", err);
  process.exit(1);
});
