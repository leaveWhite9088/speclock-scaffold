# AGENTS.md — SpecLock Scaffold 工程与审核规则

本文件是仓库级 Harness 工程规则（适用于 Antigravity、Claude Code、Codex、Cursor、OpenCode、pi 等编码代理）。所有由 AI 生成或修改的代码、配置、测试与文档，在生成与自审阶段均须严格遵守本规则。

---

## 1. 架构与模块分层硬约束

仓库采用 npm workspaces 单仓五包结构，职责与依赖方向受 `packages/agentd/test/unit/layers-test.mjs` 静态门禁保护，任何越界导入均视为违规：

1. **`packages/drivers`（零依赖驱动层）**
   - 每个外部 CLI 独立一个文件，仅通过 `packages/drivers/index.mjs` 唯一入口导出。
   - 严禁导入仓库内任何其他包；执行者池只能查询驱动声明的 `capabilities`，严禁在池或守护进程代码中硬编码判断具体 CLI 名称。
2. **`packages/agentd`（核心调度守护进程）**
   - `core/` 按职责划分为 `base`、`records`、`prompts`、`pi`、`pool`、`dispatcher`、`projects` 七组，**每组有且仅有 `index.mjs` 一个重导出入口**，组外代码严禁绕过 `index.mjs` 直接导入组内私有文件。
   - `core/` 内部严格保持单向依赖（如 `core/base` 零内部依赖），严禁反向导入 `daemon/`、`client/`、`extension/` 或 `pi-adapter/`。
   - `daemon/` 操作模块之间严禁相互导入；业务规则统一收敛在 `agentd` 内。
3. **`packages/preflight`（环境预检与工具链安装）**
   - 运行在守护进程之外，与 `agentd` 仅通过清单文件交互；未显式传入 `--yes` 时只做只读探测，不得写入或改动宿主环境。
4. **`packages/backend`（HTTP + SSE 薄网关）**
   - 仅作为 `@speclock-scaffold/agentd/client` 的客户端做路由映射、请求头安全拦截与 SSE 事件转发，严禁在网关层编写调度或状态机业务逻辑。
5. **`packages/web`（React + Vite 看板）**
   - 仅通过 `/api` 与网关通信，严禁直接读写后端数据目录。

---

## 2. 编码、测试与提交约定

- **语言与模块规范**：后端与守护进程统一使用 Node.js 原生 ESM（`.mjs`），前端与扩展使用 TypeScript（`.ts` / `.tsx`）；优先使用 Node 内置模块，非必要不引入第三方运行时依赖。
- **测试隔离原则**：回归测试必须通过隔离数据目录（`AGENTD_DATA_DIR` / `packages/agentd/scripts/run-isolated.mjs`）在私有守护进程上执行，严禁污染开发者正在运行的共享 `data/` 目录。
- **命名与提交规范**：提交信息采用 Conventional Commits 格式（如 `feat(agentd): ...`、`fix(web): ...`、`test(backend): ...`、`docs: ...`）；安全与缺陷修复提交须在说明中注明对应的检查项或问题编号。
- **主干准入红线**：未经「AI 自审 + 脚本门禁 + 交叉评审」流程确认的 AI 原生代码，严禁直接合入 `main` 分支。评审维度与三分法判定见 `docs/ai-review-rubric.md`。

---

## 3. AI 生成代码核查清单（七类核查问题与检查手段）

AI 生成初稿后、提交评审前，必须对照以下七类清单逐项核查。每一类均绑定自动化脚本或规约断言，不允许以「看着没问题」代替可验证判据：

| 核查类 | 具体核查问题 | 检查手段 | 可观测判据 |
| --- | --- | --- | --- |
| **1. 接口入口** | 参数必填项与类型是否校验？是否拦截非本地 `Host` 与跨站 `Origin`？调用方身份（如项目调度器 `caller: "dispatcher"`）是否与受控资源归属项目一致？返回体是否剔除了内部敏感字段？ | 脚本：`packages/backend/test/api-test.mjs` + `packages/agentd/test/unit/ops-test.mjs` 参数与边界断言 | 缺失必填参数返回 `400`；未知路由返回 `404`；非本地 `Host` 或跨站写请求返回 `403`；跨项目实例访问一律拒绝 |
| **2. 业务逻辑** | 任务派发、排队、取消、会话切换与上下文交接（handoff）状态流转是否完整？分层依赖是否破坏了单向图？是否符合规格验收条件（AC）？ | AI 自审（对照 `ARCHITECTURE.md` 与规格）+ 脚本：`packages/agentd/test/unit/layers-test.mjs` 及队列/会话单元与集成用例 | `layers-test.mjs` 越界为 0；状态流转各分支均有对应用例且退出码为 `0` |
| **3. 数据库与持久化** | 多步状态落盘是否保证原子性或具备预写日志（`journal.mjs`）对账？并发更新或重复创建实例/任务是否由唯一键拦截而非仅靠「先查后写」？增量读取是否走顺序游标（`afterSeq`）？ | 脚本：`packages/agentd/test/unit/data-layout-test.mjs`、`packages/agentd/test/live/interrupted-test.mjs`、`transcript-test.mjs` | 重复创建同名实例稳定返回 `400`；守护进程中途终止重启后在途任务准确识别为 `interrupted`，无静默丢单或半截脏数据 |
| **4. 公共函数** | 进程销毁、RPC 通信、配置读取等公共逻辑是否收敛至 `core/base` 或 `core/pi` 单一实现而非跨文件复制？空值、超时与异常是否显式抛出而非静默吞掉？ | 脚本：`packages/agentd/test/unit/`、`packages/drivers/test/drivers-test.mjs`、`packages/preflight/test/preflight-test.mjs` | 公共模块无重复拷贝；边界值与空输入单测全绿 |
| **5. 错误处理** | 外部 CLI 启动失败、工具卡死（stuck tool）、空闲超时、守护进程停机时是否有明确出口与清理？报错信息是否避免泄漏宿主机隐私路径与密钥？ | 脚本：故障注入用例（`forced-stop-test.mjs`、`stuck-tool-test.mjs`、`start-retry-test.mjs`、`stop-guard-test.mjs`） | 卡死与超时能触发强停及进程树回收；有在途任务时拒绝不安全重启并给出明确错误码 |
| **6. 安全** | 是否防范跨项目越权与目录穿越（`dir: '..'`）？是否拦截命令注入（如 `!` 前缀 API Key）？供应商与 MCP 密钥落盘及接口返回是否脱敏？依赖包是否存在高危漏洞、历史提交是否含明文密钥？ | 脚本：`npm audit` 依赖审计 + 密钥扫描 + `api-test.mjs` / `mcp-test.mjs` / `guard.mjs` 安全反例用例 | 高危漏洞清零或有书面处置；明文密钥泄漏 0 命中；路径逃逸、`!` 注入、跨项目调用全部拦截；接口仅返回掩码提示（如 `keyHint`） |
| **7. 性能** | 长对话历史读取是否支持游标分页与裁剪（`reply.mjs` / `afterSeq`）而避免全量加载撑爆内存或上下文？执行者池是否有最大进程数上限与启动锁控制？高并发请求下网关与守护进程延迟是否达标？ | 脚本：流式与裁剪测试（`reply-test.mjs`、`compaction-test.mjs`、`stream-test.mjs`）+ 接口并发压测脚本 | 进程池严格受 `maxProcesses` 限制，同实例并发启动互斥；长对话裁剪与流式推送无阻塞，并发压测 P95 达标 |

---

## 4. 历史踩坑沉淀的强制禁令（生成阶段即拦截）

以下规则由 `LESSONS.md` 实测故障与代码审计反哺沉淀，AI 生成代码时必须无条件遵守：

1. **严禁吞掉会话切换错误**：切换或恢复会话（`session/resume`）必须携带工作目录 `cwd`；若底层 CLI 报错（如会话已处于活跃状态），必须立即中断并上抛错误，严禁忽略错误继续复用旧会话指针（会导致串会话答错内容）。
2. **严禁擅自解析或改写模型标识**：各家 CLI 的模型标识结构差异极大（扁平字符串、嵌套分组或元组），模型值一律原样透传，嵌套选项仅通过 `describeModels()` 递归拍平展示。
3. **严禁路径越出项目根**：任何创建项目实例或指定执行目录的操作，必须经 `projects.resolveInside(projectRoot, dir)` 校验，拒绝 `..` 或绝对路径逃逸。
4. **严禁调度器越权操作宿主配置**：来自 `caller: "dispatcher"` 的内部调用必须经 `daemon/guard.mjs` 的 `scopeArgs` 与 `DISPATCHER_DENIED` 过滤，严禁调度器自行修改供应商密钥、变更实例目录或关闭守护进程。
5. **严禁回显任何明文凭证**：供应商 API Key、自定义 LLM 凭证与 MCP 环境变量密钥只写不读（状态查询只允许返回尾号掩码 `keyHint`），且必须拒绝以 `!` 开头的密钥字符串以防子壳命令执行。
6. **子进程回收必须清理整棵进程树**：停止或强杀 CLI 实例时统一调用 `core/base` 的 `killTree`，防止在 Windows / POSIX 下残留孤儿孙进程占用端口与文件锁。
7. **崩溃中断的编码任务禁止后台静默自动重跑**：守护进程异常重启经 `journal.mjs` 对账发现未闭合任务时，只允许记入 `interrupted` 回执并向会话写入一次中断提示，交由用户或调度器人工核实工作区后再决定是否重发，严禁后台自动重投覆盖半成品文件。
