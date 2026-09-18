/**
 * 通用作业自动批改系统 - 计算层模拟执行器 (Mock Compute Runner)
 * 
 * 核心逻辑：
 * 1. 携带计算层鉴权 Token (Bearer Token)
 * 2. 队列为空时：按心跳间隔 (3秒) 进行轮询
 * 3. 任务队列积压时：串行阻塞处理 (拉取任务 -> 编译测试 -> 回传成绩与详细日志 -> 立即提取下一个任务)
 */

const BASE_URL = process.env.SERVER_URL || "http://localhost:8787";
const COMPUTE_AUTH_TOKEN = process.env.COMPUTE_AUTH_TOKEN || "whu-cphomework-compute-secret-key-2026";
const POLL_INTERVAL_MS = 3000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runComputeWorker() {
  console.log("=========================================================");
  console.log("  通用作业自动批改系统 - 计算层评测 Worker 启动");
  console.log(`  连接服务器: ${BASE_URL}`);
  console.log(`  鉴权令牌: ${COMPUTE_AUTH_TOKEN.substring(0, 10)}...`);
  console.log("=========================================================");

  while (true) {
    try {
      // 1. 带鉴权轮询拉取任务
      const res = await fetch(`${BASE_URL}/api/compute/task`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${COMPUTE_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (res.status === 401) {
        console.error("[Compute Error] 鉴权失败：Token 与服务端不匹配，请检查配置！");
        await sleep(5000);
        continue;
      }

      if (!res.ok) {
        console.warn(`[Compute Warn] 服务端返回状态码 ${res.status}，稍后重试...`);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = await res.json() as any;

      if (!data.hasTask || !data.task) {
        // 队列为空，按心跳间隔等待轮询
        process.stdout.write(`\r[Compute Polling] 评测队列暂无积压任务，等待中... (${new Date().toLocaleTimeString()})`);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log("\n---------------------------------------------------------");
      const task = data.task;
      console.log(`[Compute Task Received] 成功认领任务: ${task.taskId}`);
      console.log(`- 学号: ${task.studentId}`);
      console.log(`- 作业编号: ${task.assignmentId}`);
      console.log(`- 作业标题: ${task.assignmentTitle || task.title}`);
      console.log(`- 作业简介: ${task.assignmentOverview || task.overview}`);
      console.log(`- 仓库地址: ${task.repoUrl} (分支: ${task.branch || 'default'}, 目录: ${task.subpath || '.'})`);
      console.log("- 正在根据作业详情和评测要求执行测试用例...");

      // 2. 模拟计算层沙箱评测过程 (执行算法验证)
      await sleep(2500); // 模拟拉取仓库与编译执行耗时

      const isRK = task.assignmentId.includes("2");
      const score = Math.floor(90 + Math.random() * 10); // 随机生成 90~99 优异成绩

      const reportDetails = [
        `==================== 自动化作业评测报告 ====================`,
        `评测环境: Linux Workerd Sandbox x86_64 (Python 3.12 / G++ 14)`,
        `代码仓库: ${task.repoUrl}`,
        `评测时间: ${new Date().toLocaleString("zh-CN")}`,
        `----------------------------------------------------------`,
        isRK
          ? `[Test 1] 核心数值算法精度测试: 通过 (相对误差 Δ = 3.24e-6 < 1e-5)`
          : `[Test 1] 复合数值算法收敛阶测试: 通过 (收敛阶 O(h^4))`,
        isRK
          ? `[Test 2] 自适应步长截断误差检验: 通过 (容差 1e-8)`
          : `[Test 2] 综合测试点验证: 计算值输出符合规范，绝对误差 1.2e-8 < 1e-7`,
        `[Test 3] 内存泄漏与计算复杂度检查: 通过 (耗时 0.18s, 内存 14MB)`,
        `----------------------------------------------------------`,
        `最终综合评定得分: ${score} / 100`,
        `评阅评语: 代码结构良好，算法实现准确，测试用例全部通过。`,
        `==========================================================`
      ].join("\n");

      // 3. 将评测结果推回给服务器
      const reportRes = await fetch(`${BASE_URL}/api/compute/report`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${COMPUTE_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          taskId: task.taskId,
          studentId: task.studentId,
          assignmentId: task.assignmentId,
          score,
          details: reportDetails
        })
      });

      const reportOutcome = await reportRes.json() as any;
      if (reportOutcome.success) {
        console.log(`[Compute Success] 学号 ${task.studentId} 作业 ${task.assignmentId} 评测报告已写回服务器！得分: ${score}`);
      } else {
        console.error(`[Compute Error] 报告回传失败: ${reportOutcome.error}`);
      }

      console.log("[Compute Next] 串行处理完成，立即检查队列是否有下一任务...");
      // 积压情况下直接拉取下一个任务，不 sleep
    } catch (err: any) {
      console.error("\n[Compute Exception] 发生异常:", err.message);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

runComputeWorker();
