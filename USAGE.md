# 通用作业自动批改系统 (CPHomework) - 详细使用与运维指南

本文档为系统的全角色详细操作手册，包含**学生端操作全流程**、**教师/助教教学管理指南**、**算力评测沙箱运行指南**以及**Cloudflare 生产部署与运维安全指南**。

---

## 目录

- [第一部分：学生使用操作手册](#第一部分学生使用操作手册)
  - [1. 首次使用账号激活与注册](#1-首次使用账号激活与注册)
  - [2. 日常登录与会话管理](#2-日常登录与会话管理)
  - [3. 忘记密码与密码重置](#3-忘记密码与密码重置)
  - [4. 查看每周作业与算法实验规范](#4-查看每周作业与算法实验规范)
  - [5. 提交代码仓库 (Git Repository URL)](#5-提交代码仓库-git-repository-url)
  - [6. 查阅自动化沙箱批改报告](#6-查阅自动化沙箱批改报告)
  - [7. 修改个人登录密码](#7-修改个人登录密码)
- [第二部分：教师与助教管理指南](#第二部分教师与助教管理指南)
  - [1. 初始登录与修改默认弱密码](#1-初始登录与修改默认弱密码)
  - [2. 教学监控大屏指标解读](#2-教学监控大屏指标解读)
  - [3. 发布与更新每周实验作业](#3-发布与更新每周实验作业)
  - [4. 查看全班学生提交详情与日志](#4-查看全班学生提交详情与日志)
  - [5. 未交作业学号精准排查与一键催交](#5-未交作业学号精准排查与一键催交)
  - [6. 导出安全防注入 CSV 成绩单](#6-导出安全防注入-csv-成绩单)
  - [7. 动态管理 Git 仓库白名单前缀](#7-动态管理-git-仓库白名单前缀)
  - [8. 作业删除与级联清理](#8-作业删除与级联清理)
- [第三部分：算力节点与评测沙箱接入指南](#第三部分算力节点与评测沙箱接入指南)
  - [1. 计算层通信握手与鉴权协议](#1-计算层通信握手与鉴权协议)
  - [2. 独占任务租约与幂等防重放机制](#2-独占任务租约与幂等防重放机制)
  - [3. 启动内置模拟评测 Worker](#3-启动内置模拟评测-worker)
  - [4. 生产环境评测沙箱编写参考 (Docker + Python)](#4-生产环境评测沙箱编写参考-docker--python)
- [第四部分：Cloudflare 生产部署与运维指南](#第四部分cloudflare-生产部署与运维指南)
  - [1. 凭证与机密安全铁律](#1-凭证与机密安全铁律)
  - [2. 创建 Cloudflare KV 命名空间](#2-创建-cloudflare-kv-命名空间)
  - [3. 配置生产机密 (Wrangler Secret Put)](#3-配置生产机密-wrangler-secret-put)
  - [4. 邮件发信服务配置 (Resend API)](#4-邮件发信服务配置-resend-api)
  - [5. Turnstile 生产环境人机核验密钥配置](#5-turnstile-生产环境人机核验密钥配置)
  - [6. 一键构建与部署命令](#6-一键构建与部署命令)
  - [7. 常见问题与故障排查 (FAQ)](#7-常见问题与故障排查-faq)

---

## 第一部分：学生使用操作手册

### 1. 首次使用账号激活与注册

系统对选课学生采取**预置学号白名单 + 邮箱双重核验**的激活注册机制：

1. 打开系统网址（本地开发环境为 `http://localhost:8787`）；
2. 页面默认展示登录窗口，点击下方的 **“验证码快速激活 / 重置”** 或顶部 Tab 切换到 **“首次注册 / 重置密码”**；
3. **输入 13 位学号**：例如 `2023302020001`（系统仅允许选课名单内的学号）；
4. **安全人机验证**：完成页面中的 Cloudflare Turnstile 验证框（出现绿色打勾）；
5. **获取验证码**：
   - 点击 **“获取验证码”** 按钮；
   - 系统将验证码发送至绑定的学生邮箱；
   - 验证码有效期为 **30 分钟**；
   - 发送后系统会启动 **10 分钟发送冷却锁**（倒计时期间禁止重复请求，防刷发信额度）；
   - *（本地开发或测试模式下，界面会自动弹出测试验证码提示，点击“自动填入”即可）*；
6. **设置新密码**：
   - 填写收到的 6 位数字验证码；
   - 输入您自定义的登录密码（长度在 6 到 64 位之间，不可设置为 `123456` 等弱密码）；
   - 提交后自动完成注册并直接登入系统。

---

### 2. 日常登录与会话管理

1. 打开登录页面，输入学号及您设置的密码；
2. 完成 Turnstile 人机验证后点击 **“登录”**；
3. 登录成功后将直接进入 **“学生工作台”**；
4. 登录会话凭证有效期为 7 天。点击右上角 **“退出”** 按钮可安全登出，历史凭据即刻失效。

---

### 3. 忘记密码与密码重置

若遗忘密码，无需联系助教手动重置：

1. 在登录页面点击 **“忘记密码？”** 或切换至 **“首次注册 / 重置密码”**；
2. 输入您的 13 位学号并完成人机验证；
3. 点击 **“获取验证码”**，系统将新验证码投递至学生邮箱；
4. 输入验证码与新密码，点击重置即可直接登入，旧会话凭据即刻失效。

---

### 4. 查看每周作业与算法实验规范

在学生工作台首页：

1. 页面列出当前学期已发布的全部实验课题（按周次排列）；
2. 每个作业卡片上清晰标注：
   - **作业标题**与**核心简介**；
   - **当前提交状态**（未提交 / 排队中 / 评测中 / 已批改出分）；
3. 点击 **“查看详情与评测要求”** 可展开完整的实验要求、理论背景、输入输出格式及容差标准。

---

### 5. 提交代码仓库 (Git Repository URL)

1. 在卡片下方输入框中粘贴您存放作业的 Git 仓库公开 HTTPS 地址，例如：
   ```text
   https://github.com/your-username/my-course-homework
   ```
2. **多周作业单仓 (Monorepo) 与分支支持**：
   - 如果您所有周次的作业都放在同一个仓库的不同文件夹或分支中，可直接在输入框中填入完整的 GitHub 网页分支/目录路径，例如：
     ```text
     https://github.com/your-username/course-hw/tree/main/week1
     ```
     服务端会自动识别并提取主干仓库、目标分支（`main`）以及子路径（`week1`）；
   - **容错支持**：地址尾部多余的斜杠 `/` 系统会自动剥离清洗；
3. **安全提交约束**：
   - 严禁输入含有空格、命令拼接分号 `;`、路径穿越 `..` 或以 `-` 开头的异常分支名；
   - 系统**不设截止时间**，学生在学期期间均可提交或更新版本；
4. **提交状态流转与多轮迭代**：
   - 首次提交时点击 **“提交开始评测”**；
   - 评测完成后，若想根据沙箱评测意见改进代码，修改后点击 **“更新提交版本”**（按钮会标注当前迭代轮次，如“第 2 轮”、“第 3 轮”）；
   - 任务成功推入队列，卡片状态徽章将即刻变为 **“任务排队中”**（黄色）；
   - 当计算沙箱认领后，变为 **“沙箱评测中”**（蓝色带旋转动画）；
   - 批改完成后，状态变为 **“得分: XX / 100”**（绿色），页面会自动停止轮询，节省流量。

> **排队互斥说明**：当您提交了一个版本且任务正处于“排队中”或“评测中”时，系统禁止重复提交新版本。请耐心等待 10~30 秒出分后再进行下一次迭代。

---

### 6. 查阅自动化沙箱批改报告与多轮迭代轨迹

当作业状态显示为已批改出分后：

1. 展开该作业卡片，可直接查阅：
   - **当前最新得分**：例如 `得分: 96 / 100`；
   - **当前迭代轮次徽章**：标明是 `第一次评测`、`第二次评测` 或后续轮次；
   - **黑色沙箱终端日志**：展示沙箱编译、用例断言、误差判定与 Agent 综合反馈；
2. **历史评价轮次记录与改进轨迹**：
   - 若您进行了多次提交，下方会呈现可折叠的历史轨迹折叠面板；
   - 展开可清晰回顾先前的每一次提交时间、得分演变、提交仓库分支以及当时的扣分诊断详情；
   - 计算层 Agent 会自动结合前序各轮次的反馈提示（`historyPrompt`），检查您本次是否修复了先前的缺陷，并逐步提高得分。

---

### 7. 修改个人登录密码

1. 点击网页顶部右上角的 **“修改密码”**；
2. 弹出密码修改窗口；
3. 输入您的 **原登录密码**；
4. 输入新密码并二次确认（禁止将新密码设为 `123456` 或与原密码相同）；
5. 完成下方的 Turnstile 人机安全核验；
6. 点击 **“确认修改密码”**。修改成功后，旧登录凭证自动失效。

---

## 第二部分：教师与助教管理指南

### 1. 初始登录与修改默认弱密码

系统预置了默认管理员凭据，首次使用必须完成提权改密：

1. 在登录界面输入用户名 `admin`，密码 `123456`，点击登录；
2. 登录成功后，页面顶端会显示极其醒目的**高危红色安全告警横幅**：
   > **【高风险安全告警】管理员账户当前仍在使用默认弱密码 (123456)**  
   > 任何知晓此系统的外部人员均可轻易登录并篡改系统配置！请立即点击右侧按钮修改管理员密码。
3. 点击告警横幅上的 **“立即修改密码”**；
4. 输入原密码 `123456`，设置一个包含字母大小写、数字或特殊字符的强密码，完成人机验证后保存；
5. 改密后告警横幅自动消失，`isDefaultPassword` 标记清除，系统安全性得到保障。

---

### 2. 教学监控大屏指标解读

教师控制台顶部提供 4 项全局核心指标卡片：

- **选课白名单人数**：硬编码白名单中的总学生人数（全班基数）；
- **已注册学生数**：已经在系统中激活了账号的学生人数，下方附带全班**激活率百分比**；
- **评测队列积压任务**：当前正等待计算沙箱拉取评测的任务数量。正常情况下该数值维持在 0~5；若该数值持续偏高，说明远端计算沙箱节点未启动或网络断开，需检查 Worker 进程；
- **当前已发布作业**：当前学期对学生开放的作业总数量。

---

### 3. 发布与更新每周实验作业

1. 在管理后台的 **“作业管理与发布”** 标签页，点击右上角蓝色 **“发布新作业”** 按钮；
2. 弹窗中按提示填写：
   - **周次**：第几周的作业（数字 1~52，例如 `3`）；
   - **作业标题**：例如 `第三周：算法实现与综合测试`；
   - **作业简介**：简明扼要的 1~2 句话概述，显示在学生卡片表面；
   - **作业详情与评测要求**：详细的技术指标、输入输出文件要求、算法容差、综合测试要求等（支持详细 Markdown，计算层 Agent 将自动读取并直接用于生成测试用例）；
3. 点击 **“确认发布”**；
4. 系统将在 KV 中持久化该作业，作业默认全天候向学生开放提交，支持学生多次迭代刷分改进，并自动向操作审计日志写入 `publish_assignment` 记录。

---

### 4. 查看全班学生提交详情与日志

在作业列表表格中：

1. 找到对应的周次作业，点击 **“查看提交 (N)”** 按钮；
2. 弹出学生提交明细表格：
   - **学号**：提交学生的 13 位学号；
   - **得分**：沙箱评定的综合分数；
   - **代码仓库**：带有外链图标的学生仓库 URL（系统自动检查 URL 合法性，禁止执行恶意伪协议）；
   - **状态**：已出分 / 评测中 / 排队中；
   - **提交时间**：最近一次提交的具体时间；
3. 点击右侧的 **“查看日志”**，可在下方即刻展开该学生测试的完整沙箱输出日志，便于复核争议成绩。

---

### 5. 未交作业学号精准排查与一键催交

这是本系统针对高校教学场景专门优化的核心功能，彻底解决助教催交作业耗时耗力的痛点：

1. 在作业列表点击 **“排查未交”**，或切换至 **“未交学号精准排查”** 标签页；
2. 顶部下拉框可自由切换不同周次的作业；
3. 系统自动实时比对计算，并在两侧展现清晰的对照卡片：
   - **左侧：已激活账号但未提交名单**（已登入过系统但未交作业的同学）；
   - **右侧：白名单全量未提交名单**（全班尚未交作业的所有学号，包含未激活者）；
4. **多格式一键催交与复制**：
    - 顶部提供 **“一键复制格式”** 切换栏，支持 4 种常用格式：
      - **逗号分隔 (推荐，默认)**：以英文逗号加空格分隔（如 `2023302020001, 2023302020002`），粘贴到群聊、邮件或搜索框清晰规范；
      - **中文逗号**：以全角逗号分隔（如 `2023302020001，2023302020002`）；
      - **换行分隔**：每行一个学号，便于粘贴入 Excel 竖列；
      - **催交通知模板**：一键生成带有作业标题、未交分类与学号清单的完整催交提醒文案；
    - 点击卡片右上角 **“一键复制”** 按钮即可快速复制到剪贴板，按钮会明确显示当前复制格式并给出独立复制反馈！

---

### 6. 导出安全防注入 CSV 成绩单

期末或每周结课统计分数时：

1. 在作业管理表格中，点击操作列的绿色 **“导出成绩单”** 按钮；
2. 浏览器将自动触发下载 `assignment_hw-X_submissions.csv` 文件；
3. **格式与安全保障**：
   - **UTF-8 BOM (`\uFEFF`)**：文件头内置标准微软签名序列，在 Windows 平台使用 Microsoft Excel 打开时，中文字符正常显示，避免乱码；
   - **公式注入自动中和 (Anti-CSV-Injection)**：针对学生提交的代码仓库、日志或备注中若包含以 `=`, `+`, `-`, `@`, `\t`, `\r` 开头的字符，系统在导出时会自动前置单引号 `'` 并按 RFC 4180 进行双引号严格包裹，避免 Excel 宏与 DDE 执行风险。

---

### 7. 动态管理 Git 仓库白名单前缀

防止学生提交非法链接或内网穿透地址：

1. 切换至 **“仓库白名单配置”** 标签页；
2. 在输入框中输入允许的 Git 托管平台前缀（多个前缀使用英文逗号分隔）；
3. **格式要求**：前缀必须以 `https://` 开头，并以 `/` 结尾，例如：
   ```text
   https://github.com/, https://gitee.com/, https://gitlab.com/
   ```
4. 点击 **“保存白名单配置”**，即刻全局生效。

---

### 8. 作业删除与级联清理

1. 在作业列表点击右侧红色的 **删除（垃圾桶）** 按钮；
2. 弹窗二次确认；
3. 确认后，系统不仅会下线该作业，还会清理该作业对应的关联提交索引与历史记录，并向系统审计日志记录留痕。

---

## 第三部分：算力节点与评测沙箱接入指南

### 1. 计算层通信握手与鉴权协议

计算层评测集群通过专用的 Serverless 通信协议与控制层握手通信：

- **认证标头**：计算节点每次请求必须携带以下任一凭据头：
  - `X-Compute-Token: <COMPUTE_AUTH_TOKEN>`
  - `Authorization: Bearer <COMPUTE_AUTH_TOKEN>`
- **拉取任务接口 (`GET /api/compute/task`)**：
  - 请求方式：`GET`
  - 响应示例（无排队任务）：
    ```json
    { "success": true, "hasTask": false }
    ```
  - 响应示例（成功认领任务）：
    ```json
    {
      "success": true,
      "hasTask": true,
      "task": {
        "taskId": "task-1789710825389-6fvn0",
        "studentId": "2023302020001",
        "assignmentId": "hw-1",
        "assignmentTitle": "第一周：数值算法与误差分析",
        "assignmentOverview": "实现高精度数值算法，检验收敛性与数值稳定性。",
        "assignmentDetails": "【作业要求】\n1. 请在仓库根目录下提供 solution.py 或 main.cpp...\n2. 相对误差必须 < 1e-7。",
        "currentRound": 2,
        "currentRoundLabel": "第二次评测",
        "history": [
          {
            "round": 1,
            "roundLabel": "第一次评测",
            "score": 75,
            "details": "用例1通过；用例2误差未达标，建议优化步长..."
          }
        ],
        "historyPrompt": "### 先前评价轮次与迭代改进提示词...\n> 本次为学生的【第二次提交（第 2 次评测）】。请重点核查学生是否针对先前缺陷进行了修复，修复后应当相应提升分数！",
        "repoUrl": "https://github.com/student/hw1",
        "branch": "main",
        "subpath": "algorithm",
        "submittedAt": "2026-03-18T10:00:00.000Z"
      }
    }
    ```
- **回传结果接口 (`POST /api/compute/report`)**：
  - 请求体：
    ```json
    {
      "taskId": "task-1789710825389-6fvn0",
      "studentId": "2023302020001",
      "assignmentId": "hw-1",
      "score": 96.5,
      "details": "[PASS] 辛普森算法精度达标，误差 1.2e-8 < 1e-7..."
    }
    ```
  - 响应状态码：
    - `200 OK`: 成绩与日志持久化成功；
    - `200 OK` + `{ idempotent: true }`: 网络重发相同的完结报告，幂等放行；
    - `409 Conflict`: 任务已被更新版本覆盖，或试图篡改已评分任务的成绩。

---

### 2. 独占任务租约与幂等防重放机制

- **180s 独占分布式租约**：当某算力节点通过 `GET /api/compute/task` 提取任务时，服务端会写入 `queue:lease:${taskId}`，有效期 180 秒。在 180 秒内，其他算力节点无法重复领取该任务；
- **任务完结与租约回收**：计算节点调用 `POST /report` 成功写回成绩后，服务端会立即原子释放该任务的租约与队列索引；
- **网络抖动容错**：若算力节点在回传报告时遇到网络丢包重试，服务端自动识别重复发送的相同成绩并放行，避免算力节点误报异常。

---

### 3. 启动内置模拟评测 Worker

项目自带开箱即用的模拟算力执行器：

```bash
# 使用默认配置启动 (连接本地 http://localhost:8787)
pnpm run runner
```

若需连接远程服务器或使用自定义 Token：
```bash
# Linux / macOS
SERVER_URL="https://your-domain.com" COMPUTE_AUTH_TOKEN="your-token" pnpm run runner

# Windows PowerShell
$env:SERVER_URL="https://your-domain.com"; $env:COMPUTE_AUTH_TOKEN="your-token"; pnpm run runner
```

---

### 4. 生产环境评测沙箱编写参考 (Docker + Python)

在真实的计算节点或集群上运行隔离沙箱，推荐使用 Docker 执行不可信的学生代码：

```python
import time, requests, subprocess, tempfile, os

SERVER = "https://cphomework.yourdomain.com"
TOKEN = "your-compute-token-here"
HEADERS = {"X-Compute-Token": TOKEN, "Content-Type": "application/json"}

def poll_and_grade():
    while True:
        try:
            res = requests.get(f"{SERVER}/api/compute/task", headers=HEADERS, timeout=10)
            if not res.ok:
                time.sleep(3)
                continue
            data = res.json()
            if not data.get("hasTask"):
                time.sleep(3)
                continue
            
            task = data["task"]
            print(f"认领任务: {task['taskId']}, 学号: {task['studentId']}")

            with tempfile.TemporaryDirectory() as tmpdir:
                # 1. 安全拉取仓库
                branch_flag = f"-b {task['branch']}" if task.get("branch") else ""
                clone_cmd = f"git clone --depth 1 {branch_flag} {task['repoUrl']} {tmpdir}/code"
                subprocess.run(clone_cmd, shell=True, check=True, timeout=30)
                
                # 2. 启动隔离 Docker 容器执行编译与测试
                target_dir = os.path.join(f"{tmpdir}/code", task.get("subpath", ""))
                docker_cmd = [
                    "docker", "run", "--rm",
                    "--network", "none",            # 禁用容器网络防反弹 Shell
                    "--memory", "512m",             # 限制内存防 OOM
                    "--cpus", "1.0",                # 限制 CPU
                    "-v", f"{target_dir}:/workspace",
                    "-w", "/workspace",
                    "cphw-sandbox-env:latest",
                    "python3", "/test_suite/run_grading.py"
                ]
                
                proc = subprocess.run(docker_cmd, capture_output=True, text=True, timeout=60)
                score = 95.0 if proc.returncode == 0 else 60.0
                details = proc.stdout + "\n" + proc.stderr

                # 3. 推回成绩报告
                report_payload = {
                    "taskId": task["taskId"],
                    "studentId": task["studentId"],
                    "assignmentId": task["assignmentId"],
                    "score": score,
                    "details": details[:32768]
                }
                requests.post(f"{SERVER}/api/compute/report", json=report_payload, headers=HEADERS)

        except Exception as e:
            print(f"执行异常: {e}")
            time.sleep(3)

if __name__ == "__main__":
    poll_and_grade()
```

---

## 第四部分：Cloudflare 生产部署与运维指南

### 1. 凭证与机密安全铁律

- **严禁将 `.dev.vars` 提交到 GitHub 或任何公开仓库**；
- 本仓库已在 `.gitignore` 中配置了机密忽略规则；
- 生产环境的所有敏感密码和密钥必须通过 Cloudflare 提供的安全密钥管理通道（Wrangler Secret）注入。

---

### 2. 创建 Cloudflare KV 命名空间

运行以下命令在 Cloudflare 边缘网络创建持久化 KV 命名空间：

```bash
npx wrangler kv namespace create CPHW_KV
```

控制台会返回类似如下的信息：
```text
Creating namespace with title "cphomework-CPHW_KV"
Success!
Add the following to your configuration file:
[[kv_namespaces]]
binding = "CPHW_KV"
id = "a1b2c3d4e5f67890abcdef1234567890"
```

将上面返回的 `id` 填入 `wrangler.jsonc` 的 `kv_namespaces[0].id` 中：
```jsonc
  "kv_namespaces": [
    {
      "binding": "CPHW_KV",
      "id": "a1b2c3d4e5f67890abcdef1234567890"
    }
  ]
```

---

### 3. 配置生产机密 (Wrangler Secret Put)

在终端执行以下命令，根据提示输入高强度的生产密钥：

```bash
# 1. 设置生产 JWT 签名密钥 (建议 32 位以上随机串)
npx wrangler secret put JWT_SECRET

# 2. 设置计算层通信令牌 (算力集群与服务端的通信口令)
npx wrangler secret put COMPUTE_AUTH_TOKEN

# 3. 设置 Cloudflare Turnstile 密钥
npx wrangler secret put TURNSTILE_SECRET_KEY

# 4. (可选) 设置 Resend 发信服务 API 密钥
npx wrangler secret put RESEND_API_KEY
```

---

### 4. 邮件发信服务配置 (Resend API)

若需向学生的 `@whu.edu.cn` 真实发送验证码邮件：

1. 注册并登录 [Resend.com](https://resend.com)；
2. 绑定您的发信域名并配置 DNS（SPF、DKIM 解析记录）；
3. 生成 API Key，并在生产环境执行：
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
4. 将 `src/server/auth.ts` 中的发信人地址配置为您的已验证域名（例如 `cphomework@yourdomain.com`）。

---

### 5. Turnstile 生产环境人机核验密钥配置

1. 登录 Cloudflare Dashboard；
2. 进入 **Turnstile** 菜单，点击 **Add Widget**；
3. 站点类型选择 **Managed**，填入您的生产域名；
4. 创建成功后，获取 **Site Key** 与 **Secret Key**；
5. 将 **Site Key** 填入前端组件 `src/client/components/TurnstileWidget.tsx` 中的 `siteKey` 默认值；
6. 将 **Secret Key** 注入服务端：
   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

---

### 6. 一键构建与部署命令

```bash
# 1. 安装最新依赖
pnpm install

# 2. 执行自动化类型检查与回归测试 (确保 100% 通过)
npx tsc --noEmit
npx tsx scripts/test-system.ts

# 3. 打包前端静态 SPA 资源并一键发布至 Cloudflare Workers
pnpm run deploy
```

部署完成后，Wrangler 会输出您专属的 Workers 生产域名（例如 `https://cphomework.<your-subdomain>.workers.dev`）。您可以在 Cloudflare 控制台为其绑定自定义二级域名（例如 `https://cphomework.example.com`）。

---

### 7. 常见问题与故障排查 (FAQ)

#### Q1: 页面提示“验证码在10分钟内已发过，必须等待XXX秒”？
**解答**：这是系统针对发信额度设置的 10 分钟防刷冷却锁。请学生先去绑定的学生邮箱（垃圾箱/收件箱）查收上一封邮件。若确实未收到，倒计时结束后方可重新索要。

#### Q2: 出现 401 Unauthorized 并且页面被踢回登录界面？
**解答**：发生以下任一情况时，凭据会立即被边缘节点吊销：
- 登录凭据超过 7 天自然过期；
- 用户在其他窗口或设备修改了密码；
- 用户主动点击了“退出登录”。  
重新登录即可获取全新凭证。

#### Q3: 为什么输入了学号却提示“不在选课名单内”？
**解答**：系统内嵌了硬编码白名单。若有转专业、补选课同学需要使用系统，请任课老师或助教在 `src/config/whitelist.ts` 文件中追加该学号，并重新执行 `pnpm run deploy` 即可。

#### Q4: 学生提交了作业，但状态一直显示“任务排队中”？
**解答**：
1. 检查教师控制台大屏上的“评测队列积压任务”指标；
2. 检查远端算力沙箱节点是否在线运行；
3. 检查计算节点的 `COMPUTE_AUTH_TOKEN` 是否与 Workers 服务端一致。

#### Q5: 导出 CSV 成绩单时，Excel 打开提示安全风险？
**解答**：完全不用担心。系统已对所有公式敏感字符前置单引号进行了深度中和（DDE Neutralization），不会对电脑造成任何危害，可放心点击“启用编辑”查看。
