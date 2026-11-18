# 项目报告 · SpecLock Scaffold

- **项目**：SpecLock Scaffold——面向业务驱动开发的多模型编码代理调度系统
- **成员与分工**：
  - 架构与调度守护进程（提交集中在 `packages/agentd/`、`packages/drivers/`、`ARCHITECTURE.md`；三查记录 `reports/risk-concurrency.md`、`reports/risk-transaction.md`）
  - 网关、看板与预检（提交集中在 `packages/backend/`、`packages/web/`、`packages/preflight/`；试用反馈记录 `reports/feedback.md`）
  - 安全审计、门禁与交付验证（提交集中在 `AGENTS.md`、`scripts/`、`Makefile`、`Dockerfile`、`docker-compose.yml`、`.github/workflows/ci.yml`；安全与压测记录 `reports/security-baseline.md`、`reports/bench.md`）
  > 注：提交课堂派前可将上方括号前替换为组内成员真实姓名与组号。
- **仓库地址**：`git@github.com:leaveWhite9088/speclock-scaffold.git`
- **演示视频下载地址**：`【汇报当天填入百度网盘或北大网盘链接】`（录屏分镜与验证命令顺序见 `reports/demo-script.md`）
- **使用的 Harness**：Google Antigravity、Claude Code、pi（模型 Gemini、Claude、DeepSeek）
- **支撑记录目录**：`reports/`（评审记录、高风险三查、安全自查与整改、门禁红绿屏、容器与流水线、观测告警、压测与用户反馈）
- **提交日期**：2026-11-18

---

## 1. 一句话介绍

SpecLock Scaffold 面向使用多种 AI 编码工具开展中长周期业务开发的软件团队，解决多模型会话孤立、需求变更易串上下文以及编码代理自写自验缺乏把关的问题：开发者只需向调度器提出需求并批准业务审核单，系统即按锁定版本的模块规格将实现与独立测试任务异步分派给不同原生 Harness 中的执行者并行完成，并逐条附验收证据交回结果。

---

## 2. AI 写了什么

本组全部业务代码、架构设计与说明文档均由 AI 在规格与规则约束下生成。代码与规约之外的 AI 工程治理与验证产出逐项列全如下：

- **规则与评审标准文件**：
  - 仓库根目录 `AGENTS.md`（含五包单向分层硬约束、第 3 节「七类代码核查清单」与第 4 节历史踩坑强制禁令）
  - `docs/ai-review-rubric.md`（三层核查分工、高风险代码四步拆解法、七维度评审表与三分法准入规程）
- **自动化测试与安全反例套件**：
  - `packages/agentd/test/unit/`（22 个单元与契约测试，含 `layers-test.mjs` 静态分层门禁、`security-audit-test.mjs` 越权与注入反例、`queue-test.mjs` 并发队列）
  - `packages/agentd/test/live/`（隔离私有守护进程集成测试，含 `interrupted-test.mjs` 崩溃恢复对账）
  - `packages/backend/test/api-test.mjs`、`packages/drivers/test/drivers-test.mjs`、`packages/preflight/test/preflight-test.mjs`
- **代码审核记录**：`reports/review-01.md`～`reports/review-04.md`（脚本门禁、AI 自审与人工确认四份闭环记录，见第 3 节）
- **高风险三查与安全归档**：
  - 高风险三查：`reports/risk-concurrency.md`（并发）、`reports/risk-transaction.md`（事务与崩溃一致性）、`reports/risk-authz.md`（权限）
  - 安全自查与实验：`reports/security-precheck.md`、`reports/security-fix-log.md`、`reports/security-baseline.md`、`reports/sec08-experiment.md`
- **压测脚本与性能报告**：`scripts/bench.mjs`（支持环境变量配置并发数与时长）与 `reports/bench.md`（缓存优化前后两轮同参数对比数据）
- **验证命令、容器与 CI 流水线编排**：
  - 门禁编排：`Makefile`（`make check`、`make check-security`、`make bench`）、`scripts/check-security.mjs`、`scripts/security-allowlist.json`
  - 容器与持续集成：`Dockerfile`、`docker-compose.yml`、`docker/nginx.conf`、`.github/workflows/ci.yml`（支撑记录见 `reports/boot-reproduce.md`、`reports/pipeline.md`、`reports/observe-alert.md`、`reports/feedback.md`）
- **自述与运维手册**：`README.md`、`ARCHITECTURE.md`、`LESSONS.md`、`docs/REFERENCE.md`
- **使用的 Harness**：Antigravity、Claude Code、pi
- **七类代码核查问题与检查手段**（完整判据见 `AGENTS.md` 第 3 节）：

| 类 | 核查问题 | 检查手段 |
| --- | --- | --- |
| 接口入口 | 参数必填校验、本地 `Host`/`Origin` 拦截、项目作用域绑定、响应脱敏是否完整 | 脚本 `packages/backend/test/api-test.mjs` + `security-audit-test.mjs` + `ops-test.mjs` |
| 业务逻辑 | 任务派发、排队取消、会话切换与模块绑定是否符合规格；包间单向依赖是否越界 | AI 自审对照 `ARCHITECTURE.md` + 脚本 `layers-test.mjs`、`rules-test.mjs`、`reports-test.mjs` |
| 数据库与持久化 | 预写日志（`journal.mjs`）崩溃对账、配置原子重命名写盘、实例唯一键与游标分页是否可靠 | 脚本 `data-layout-test.mjs`、`interrupted-test.mjs`、`pi-models-test.mjs` |
| 公共函数 | 进程树销毁、RPC 通信、路径校验是否收敛至基础模块且未吞掉异常 | 脚本 `drivers-test.mjs`、`preflight-test.mjs`、`acp-small-parts-test.mjs` |
| 错误处理 | CLI 启动失败重试、工具卡死强停、有在途任务拒绝停机是否有明确出口 | 脚本故障注入用例 `forced-stop-test.mjs`、`stuck-tool-test.mjs`、`start-retry-test.mjs` |
| 安全 | 跨项目越权、路径穿越、`!` 前缀命令注入、CSRF/XSS、明文密钥泄漏与依赖漏洞是否受控 | 脚本 `make check-security`（`scripts/check-security.mjs` + `security-audit-test.mjs`） |
| 性能 | 长对话裁剪与增量推送、进程池上限、高频回执检索并发吞吐与 P95 是否达标 | 脚本 `reply-test.mjs`、`compaction-test.mjs` + 压测脚本 `scripts/bench.mjs` |

---

## 3. 审核记录

| # | 用什么手段查 | 查了什么 | 怎么判的 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | 脚本门禁执行 `npm --prefix packages/agentd run test:queue` | `packages/agentd/test/unit/queue-test.mjs` 并发排队取消后的收尾状态断言与进程退出清理 | 取消排队任务并跑完后续任务后 `inflight === 0` 且等待队列为空，脚本退出码须为 `0` | 初跑为红：引用了重构前的旧私有字段抛出 `TypeError` 且同步 `process.exit` 触发句柄异常 → 对齐公开方法 `waitingJobs()` 并自然排空事件循环后转绿常驻。记录：`reports/review-01.md` |
| 2 | AI 自审按 `AGENTS.md` 第 3 节「接口入口」与「安全」类审查 `daemon/ops/system.mjs`、`guard.mjs`、`receipts.mjs` | 多项目回执查询单侧过滤、回执调用来源字段及越权拒绝审计留痕 | 带 `project` 查询回执须 0 跨项目泄漏；被 `guard.mjs` 拦截的越权请求须单行 JSON 落盘可查 | 自审报出「`system.mjs` 漏透传 `project` 致跨项目回执混出」及「越权拦截无审计记录」→ 补齐单侧过滤、`caller` 字段与 `audit.jsonl` 落盘，新增 `security-audit-test.mjs` 常驻转绿。记录：`reports/review-02.md` |
| 3 | AI 自审按 `AGENTS.md` 第 3 节「性能」类审查 `daemon/receipts.mjs` 并配合 `scripts/bench.mjs`（`VUS=20`）压测 | 1,200 条历史回执场景下 `GET /api/receipts` 并发检索延迟与事件循环阻塞情况 | 20 并发下回执检索 P95 应 `< 25 ms`、错误率 `0%`，且缓存失效不得产生脏读 | 压测暴露每次请求全文件同步读盘与 `JSON.parse` 致吞吐仅 `464.5 QPS`、P95 `61.34 ms` → 增加基于 `(size, mtimeMs)` 校验与写穿失效的项目级缓存，复测升至 `2,465.0 QPS`、P95 `15.71 ms`。记录：`reports/review-03.md` |
| 4 | 人工确认复核 `core/records/journal.mjs` 与 `daemon/startup.mjs` 的崩溃恢复语义 | 守护进程异常中断后，未闭合的在途编码任务应否后台自动重新投递执行 | 结合编码 CLI 可能已在工作区写出半截文件的副作用风险裁决恢复策略 | 确认「不静默自动重跑，仅单次对账记入 `interrupted` 回执并通知会话交由人/调度器决定」，同时将该结论补入 `AGENTS.md` 第 4 节第 7 条并由 `interrupted-test.mjs` 守卫。记录：`reports/review-04.md` |

四份审核记录中，前 3 份由脚本门禁与 AI 自审直接发现，仅第 4 份由人工裁决机器无法自动判定的业务副作用取舍，且裁决结果已同步固化进规则文件与常驻用例。

---

## 4. 高风险三查

- **并发**（脚本复跑：`npm --prefix packages/agentd run test:queue` 与 `test:start`）：对同一执行者连续并发投递多条慢速与快速任务并在中途取消等待项，断言单实例严格串行单飞、被取消等待项永不送达底层 CLI、前后任务不受干扰且同名实例重复创建稳定返回 `400`。结果：全部并发交错与重试上限断言通过，结束后 `inflight === 0`，用例常驻 `make check`。记录：`reports/risk-concurrency.md`
- **事务与崩溃一致性**（脚本复跑：`npm --prefix packages/agentd run test:interrupted` 与 `test:models-json`）：向 `journal.jsonl` 注入未闭合在途任务与半截损坏 JSON 行并模拟守护进程两次重启，同时校验 `models.json` 临时文件写入加原子 `rename` 机制。结果：半截脏行被安全忽略，未完成任务恰好生成 1 条 `interrupted` 回执与 1 次会话通知，二次重启绝不重复记账。记录：`reports/risk-transaction.md`
- **权限**（脚本复跑：`npm --prefix packages/agentd run test:security`）：以 `projA` 调度器身份尝试跨项目调用 `projB~coder`、传入 `../outside-dir` 逃逸项目根、调用 `provider.save` / `audits` 管理接口及按项目查询回执。结果：跨项目与越权调用 100% 在守护进程入口被拒并记入 `audit.jsonl`，`project=projA` 回执单侧过滤实现 0 跨项目泄漏。记录：`reports/risk-authz.md`

---

## 5. 门禁与演示

- **验证命令（本地与 CI 完全同源）**：
  - 安全门禁：`npm run check:security`（等价于 `make check-security`：全量历史/产物/日志密钥扫描 0 命中、未登记高危依赖 0 条、越权与注入反例全绿，退出码 `0`）
  - 质量总门禁：`npm run check`（等价于 `make check`：安全门禁 + `drivers` + `preflight` + `agentd` 全部 22 个单元与分层契约套件全绿，退出码 `0`）
  - 容器一键启动与流水线：`docker compose up -d --wait`（三服务健康探针就绪链见 `reports/boot-reproduce.md`，GitHub Actions 自动构建与 `gitSha` 反查见 `.github/workflows/ci.yml` 与 `reports/pipeline.md`）
- **门禁先红后绿证据**：安全门禁拦截未登记依赖（退出码 `1` → `0`）与功能总门禁拦截流式分片回归（`pieces-test.mjs` 退出码 `1` → `0`）的完整终端输出均归档于 `reports/gate-red-green.md`。
- **演示录屏**（控制在 3 分钟内）：按 `reports/demo-script.md` 依次实跑 `npm run check:security`、`npm run check`、`test:interrupted` 与 `npm run bench` 展示绿屏输出，随后打开看板走通建项目、派发异步任务、查看实时流与 `/api/metrics` 观测告警状态。

---

## 6. 复盘

- **代价最大的一次返工**：历史回执查询 `GET /api/receipts` 与运行态流式轮询最初采用「每次请求全量同步读取磁盘 `receipts.jsonl` 逐行 `JSON.parse`、每次 `tail` 轮询携带完整累积文本」的直白实现；单人短会话自测正常，但在预置 1,200 条回执、20 并发压测下，`GET /api/receipts` 阻塞守护进程事件循环，吞吐跌至 `464.5 QPS`、P95 升至 `61.34 ms`（且手机端刷新长会话明显卡顿）。返工将运行中 `tail` 改为仅返回未落盘增量 `pendingText`，并为 `readReceipts` 引入基于文件 `(size, mtimeMs)` 校验与 `appendReceipt` 写穿失效的项目级内存缓存；用同一脚本 `scripts/bench.mjs`（`VUS=20`）复测，回执检索吞吐提升至 `2,465.0 QPS`（提升 5.31 倍），P95 降至 `15.71 ms`（下降 74.4%，前后完整数据见 `reports/bench.md`）。
