# 架构

一个 daemon 持有全部 agent 连接，pi 通过扩展驱动它。

```
┌──────────────────────────────────────────────────────────┐
│ pi（TUI）                                                 │
│   extension: agent-router                                │
│     · 11 个工具                                          │
│     · 3 个斜杠命令                                        │
│     · onUpdate 流式渲染（不占 context）                    │
│     · abort signal → session/cancel                      │
└──────────────────────────────────────────────────────────┘
              │ 命名管道 \\.\pipe\pi-agentd（JSONL）
              ▼
┌──────────────────────────────────────────────────────────┐
│ agentd（单例常驻，detached）                               │
│                                                          │
│   core/pool（执行者池）                                    │
│     AcpClient × 每个项目里的每个执行者                       │
│       · 活跃会话指针   · live: Set                        │
│       · 串行队列       · job 注册表 + 指标                 │
│     · 标签 / 模型（session-labels.json）                   │
│     · 回执（receipts.jsonl）                              │
│     · 事件环 + epoch/seq                                  │
│                                                          │
│   agentd.config.json → 每个 agent 的启动目录               │
└──────────────────────────────────────────────────────────┘
      │ ACP              │ ACP                 │ ACP
      ▼                  ▼                     ▼
 mcode acp         dsh --profile acp     acp-adapter.mjs
 （常驻）           （常驻）                    │ RPC
                                              ▼
                                       pi --mode rpc
```

为什么是 daemon：agent 进程的寿命不应该绑在 pi 会话上。没有 daemon 时，3 个 pi 窗口
= 3 套 agent（约 2GB）、3 份互不相识的会话状态、并发写同一个 sidecar 丢更新。

**三项扩展（协议版本 2）**

- **多实例**：池里的单位是「实例」而不是「CLI 类型」。实例 id → 一个 AcpClient 进程 → 一个固定目录。
  每个实例都属于一个项目（`core/projects` 创建、记在 `data/projects/<项目>/project.json`）；daemon 启动时池子是空的，没有项目就没有实例，也没有调度器。
- **对话记录**：`core/records/transcripts.mjs` 把经手的每一轮追加到 `data/projects/<项目>/transcripts/<执行者>/<sessionId>.jsonl`，
  `seq` 做游标。这是「补 harness 缺的」：ACP 不提供读历史的统一方式。
- **调度器就是 pi**：`core/dispatcher/dispatcher.mjs` 持有一个 `pi --mode rpc`（加载 agent-router 扩展），
  由它的 LLM 决定调哪个实例。池里的 `pi` agent 是 `--no-extensions` 的执行者，二者是两个进程。
  LLM 通过 `core/pi/models.mjs` 写 pi 的 `models.json` 来增删，随后重启调度器。

```
看板/客户端 ──► agentd ──► dispatcher (pi rpc + 扩展) ──agent_run──► agentd ──► 实例 × N
                  │
                  └──► data/projects/<项目>/（配置、对话记录、调度器会话…）
```

**仓库是 monorepo，三层各一个包：**

```
web（React SPA）──/api──► backend（HTTP+SSE 薄网关）──agentd 客户端──► agentd ──► 实例 / 调度器
```

backend 只是 agentd 的又一个客户端（和测试脚本、pi 扩展同级）：路由一对一映射到 agentd 操作，
SSE 把 `subscribe('*')` 收到的事件原样转发。业务规则只在 agentd 里，换前端或网关不动核心。

---

## 目录与分层

### 五个包，各有一个入口

| 包 | 入口 | 只负责 |
| --- | --- | --- |
| `packages/agentd` | 守护进程 `daemon/agentd.mjs`；客户端 `client/index.mjs`（对外是 `@speclock-scaffold/agentd/client`）；pi 扩展 `extension/agent-router.ts` | 调度器：daemon、执行者池、调度器 pi、pi 扩展、测试 |
| `packages/drivers` | `index.mjs`（包的 `exports` 只有这一个出口） | 每个 CLI 特有的一切，一个文件一个 CLI：npm 包与验证过的版本、启动方式、规则和 MCP 怎么交、能力（`compact`、`rules`、`mcp`、`sessionsOnDisk`）、pi 的两个环境变量、dsh 的磁盘会话读取。没有任何依赖；池里的代码问它的 `capabilities`，不判断「是哪个 CLI」 |
| `packages/preflight` | 命令行 `bin/preflight.mjs`；函数 `src/index.mjs` | 在 daemon 之外：探测、对照驱动验证过的版本、写清单、（可选，显式 `--yes`）把验证过的版本装进 `data/global/tools`。和 daemon 之间只共享清单这一份文件 |
| `packages/backend` | `src/server.mjs` | HTTP + SSE 薄网关，`src/daemon.mjs` 是它连 agentd 的那一小段 |
| `packages/web` | `src/main.tsx` | 看板 |

### agentd 的目录

```
packages/agentd/
├─ daemon/        守护进程：把 core 接成服务（socket、操作、事件、回执、启动对账）
├─ core/          核心，按功能分七组，每组一个 index.mjs（见下）
├─ client/        index.mjs：连接 + 订阅 + 续传；backend、pi 扩展、测试都用它
├─ extension/     pi 扩展 agent-router：调度器 pi 加载它，得到派活的工具和斜杠命令
├─ pi-adapter/    pi 没有 ACP，这里把 ACP 翻译成 pi RPC：acp-adapter.mjs；mcp-bridge.ts 让它加载 MCP 服务器
├─ contexts/      交给 Agent 的提示词文本：项目规则、执行者规则、名单、交接、执行者模板
├─ test/          unit/（不启动进程，或用假的 CLI）、live/（要守护进程或真实 CLI/模型）、lib/（测试共用的连接封装）
├─ scripts/       restart-daemon、run-isolated（见「测试与脚本」）
├─ agentd.config.json   全局设置，各部分读自己的那一段
└─ data/          运行数据（被 git 忽略，见「数据目录」）
```

### core 的七组

`core/` 按「这些代码是做什么的」分组，每组一个文件夹，**每组有且只有一个入口 `index.mjs`，里面只做再导出**。组外的代码只经它进组；组里其余文件是内部实现。

| 组 | 入口导出的 | 里面有什么 |
| --- | --- | --- |
| `core/base` | 数据目录的路径、`CONFIG` | `data-dir.mjs`：数据放哪（`AGENTD_DATA_DIR` 可改，私有测试守护进程靠它）；`app-config.mjs`：读 `agentd.config.json`。没有任何依赖 |
| `core/records` | 对话记录、任务与重试、在途日志 | `transcripts.mjs`：经手的每一轮追加成对话记录；`tasks.mjs`：任务身份、第几次尝试、重试上限；`journal.mjs`：在途任务的预写日志，重启后对账；`reply.mjs`：长回复裁剪（给调度器的只有头尾，全文存文件） |
| `core/prompts` | 规则文本、模板 | `rules.mjs`：调度器和执行者的规则（来源 `contexts/`）；`templates.mjs`：执行者模板（`contexts/templates/*.md`，文件头 + 系统提示词）的增删改查，执行者规则 = 通用规则 + 模板提示词，每次启动重读 |
| `core/pi` | pi 的 RPC 客户端、pi 的模型清单 | `rpc.mjs`：和 pi RPC 通话的唯一一份实现（调度器和 pi 适配器共用，只依赖 node 内置模块）；`models.mjs`：读写 pi 的 `models.json`，写前备份 |
| `core/pool` | 执行者池 | 见下 |
| `core/dispatcher` | `Dispatcher`、`savedContext` | `dispatcher.mjs`：调度器，pi 进程的生命周期、接线、模型与状态、作为交接的目标；`sessions.mjs`：会话文件的列表、命名、删除、每一轮的用时，只认目录、不碰 pi；`turn-queue.mjs`：一轮是否在跑、排队的消息、取消排队，只要一个 `send` 函数；`context.mjs`：上下文数字（存盘）与超过阈值的压缩 |
| `core/projects` | 项目、执行者配置、交接 | `manager.mjs`：项目与执行者的配置（每个项目一个文件 `data/projects/<id>/project.json`）、增删改、目录必须在项目根之内，不往项目里写任何文件；`handoff.mjs`：交接，提案、生成文档、开新会话 |

**`core/pool`**（执行者池，每个实例一个常驻 ACP 进程）：

| 文件 | 只负责 |
| --- | --- |
| `config.mjs` | CLI 注册表、各 CLI 的默认目录、超时、强停阈值 |
| `store.mjs` | 会话旁路数据：标签、目录、模型、上下文、压缩次数 |
| `registry.mjs` | 池 Map、进程数上限、同类型启动锁 |
| `instances.mjs` | 项目里的实例：把驱动、目录、规则和 MCP 配置组成一个进程；实例的清单在 `core/projects` |
| `metrics.mjs` | 运行指标与推断的健康信号 |
| `compaction.mjs` | 上下文占用与自动压缩（执行者和调度器共用） |
| `system-prompt.mjs` | 把规则交给各 CLI 的系统提示入口 |
| `mcp.mjs` | 每个实例的 MCP 服务器配置（密钥不进状态输出） |
| `providers.mjs` | 供应商（另一个地址和 Key），按设备存 `data/global/providers.json`：存取、列表不带 Key、测试（先测地址，再逐个 CLI 用它回答）、给将要启动的进程算出环境变量、参数和文件。每个 CLI 怎么接受它由驱动的 `provider` 决定（协议 anthropic/openai，作用域 process/global），测试代码在 `packages/drivers/probes/provider.mjs` |
| `install.mjs` | 本机装了什么：读预检的清单（`data/global/clis.json`），没有就在 node 旁边找；给驱动 `{ node, dir(包), version(包) }`。每次调用都重新算，清单改了不用重启 |
| `process.mjs` | 结束子进程及其整棵进程树 |
| `tool-text.mjs` | 工具的输入输出变成对话记录里的短文本 |
| `acp/` | 一个常驻 ACP 进程（入口 `acp/index.mjs` 只放出 `AcpClient`），见下 |

**`core/pool/acp`**（`client.mjs` 把下面几块组合起来，各块互相不引用）：

| 文件 | 只负责 |
| --- | --- |
| `client.mjs` | 启动与关闭、把一条提示变成一次运行 |
| `sessions.mjs` | 会话与模型：新建、续接、切换、命名、隐藏、列出；选模型并记住每个会话的配置；状态都归它，对 CLI 的请求通过传进来的函数发 |
| `transport.mjs` | 和 ACP 进程之间的线：启动、读行、应答（含自动批准权限）、带空闲/总超时的请求、放弃进程；不知道会话和运行 |
| `run-tracker.mjs` | 一次运行怎么从 `session/update` 变成状态和对话记录：文字、推理、工具调用（从开始跟到结束）、分段写入、进度；不知道进程 |
| `runs.mjs` | 运行的记账：正在跑的、最近三十次、用时窗口；被拒绝的运行（取消、不稳定）的错误 |
| `prompt-queue.mjs` | 一个执行者的排队：先进先出、按任务号取消排队中的、取消后立刻回复调用方；会话操作走同一条队 |
| `rules-channel.mjs` | 规则怎么交给 CLI：各自的通道，没有通道的放在每个会话第一条消息前 |
| `health.mjs` | 进程被强停的记录与「不稳定」的判断 |

### daemon

| 文件 | 只负责 |
| --- | --- |
| `agentd.mjs` | 只做组装：把下面几块接起来并启动 |
| `ops/` | 客户端能调的 65 个操作，按领域分六个文件：`executors`、`run`、`dispatcher`（含交接）、`projects`（含模板）、`providers`、`system`；`index.mjs` 合并，重名直接报错 |
| `dispatchers.mjs` | 执行者的事件接线、每个项目一个调度器的注册表、交接提议和连续失败计数 |
| `startup.mjs` | 启动时处理上一个守护进程没跑完的任务 |
| `server.mjs` | socket 协议、端点文件、监听 |
| `lifecycle.mjs` | 空闲回收、空闲退出、关闭 |
| `events.mjs` | 事件身份（epoch/seq）、环形缓冲、投递 |
| `guard.mjs` | 谁能调哪些操作（调度器的限制）、项目内名字解析 |
| `receipts.mjs` | 回执（每个项目一份 `receipts.jsonl`） |
| `reports.mjs` | 回报：调度器不等结果派出的任务，结束后把答案作为一条「【执行者回报】」消息交给调度器（落盘在 `projects/<项目>/reports.json`，同时结束的合成一条，调度器正在一轮里时不插队，重启后补发，在途的报为被中断） |
| `data-layout.mjs` | 启动时把旧的平铺数据目录移进下面的四个文件夹 |

### 扩展与适配器

- **`extension/`**：`agent-router.ts` 只注册 11 个工具（`agent_run`、`agent_sessions`、`agent_session_new`、`agent_session_use`、`agent_session_rename`、`agent_models`、`agent_set_model`、`agent_status`、`agent_instances`、`agent_instance_create`、`propose_handoff`）、3 个斜杠命令（`/agents`、`/agent-model`、`/agent-usage`）和每轮的执行者名单；pi 按路径加载它。`router/tools/` 是工具本身（`run`、`sessions`、`instances`、`handoff`）；`router/` 里 `daemon`（连接和按项目限定的代理）、`format`、`failure`（纯函数，可直接用 Node 测）、`roster`（名单，文本在 `contexts/roster.md`）、`commands`、`params`。
- **`pi-adapter/`**：`acp-adapter.mjs` 是 ACP ↔ pi RPC（含 `/compact`），驱动 `packages/drivers/pi.mjs` 用它启动池里的 pi 执行者；`mcp-bridge.ts` 是内层 pi 加载 MCP 服务器用的扩展。

### 依赖规则

箭头只朝一个方向：扩展 / 客户端 → daemon → core。`core` 不知道 HTTP、MCP、pi 扩展、命名管道的存在，所以能被任何前端复用（测试脚本就通过同样的 socket 驱动它）。`core` 内部：

```
base ◄── records, prompts, pi
base, records ◄── pool
base, pi, prompts, pool ◄── dispatcher
base, prompts, pool, records ◄── projects
```

**由测试守着**（`test/unit/layers-test.mjs`，直接读源码里的 import，不启动任何东西）：

- 每组都有 `index.mjs`，`core/` 顶层没有散落的文件。
- 组外的代码只能 import 组的 `index.mjs`；一个 `index.mjs` 只做再导出，且只导出自己组里的文件。测试不受这条限制：它们要单独测某一块，会直接进组。
- 一组只能引用上面箭头允许的组。
- `core/` 不引用 `daemon/`、`client/`、`extension/`、`pi-adapter/`；`daemon/` 只被 `daemon/` 自己引用；`daemon/ops/` 里的文件互不引用。
- 驱动包只被池里的代码引用，它自己不引用脚手架的任何东西（预检读的是同一份文件）。
- 唯一的例外：pi 扩展跑在 pi 的进程里，直接用 `core/records/reply.mjs`（长回复裁剪），因为 `records` 的其余文件一加载就会读状态文件。
- 例如「上次被中断的任务」（`interrupted`）不在池的实例列表里，是守护进程在返回前加上的（`daemon/startup.mjs` 的 `withInterrupted`），因为那是启动对账的信息，不是池的事实。

**数据目录**（`packages/agentd/data/`，已被 git 忽略；`AGENTD_DATA_DIR` 可整体换位置）按「属于谁」分，路径都集中在 `core/base/data-dir.mjs`：

```
data/
├─ agentd.endpoint.json          客户端靠它找到正在运行的守护进程
├─ global/                       属于这台机器，不属于任何项目
│   ├─ providers.json            供应商（地址和 Key）
│   ├─ clis.json                 预检找到的 CLI 清单（还有 clis-probes.json：行为探针的结果）
│   ├─ tools/                    预检装进来的、脚手架自己的 CLI
│   ├─ probe/                    探测某类 CLI 有哪些模型时用的空目录
│   └─ agentd.log                守护进程的日志
└─ projects/<项目id>/            属于一个项目的一切
    ├─ project.json              项目配置：根目录、执行者清单、调度器的压缩设置
    ├─ transcripts/<执行者>/     对话记录，每个会话一个 `<sessionId>.jsonl`
    ├─ dispatcher-sessions/      调度器 pi 的会话文件
    ├─ pi-sessions/<执行者>/     pi 执行者的会话
    ├─ session-labels.json       会话标签、模型选择、上下文、压缩次数
    ├─ tasks.json                任务与尝试
    ├─ receipts.jsonl            回执
    ├─ journal.jsonl             在途任务日志；interrupted.json 是被中断的记录
    ├─ results/                  长回复全文
    ├─ handoffs/<执行者>/        交接文档的副本
    ├─ rules/                    交给各 CLI 的规则文件（每次启动重写）
    ├─ provider-config/<执行者>/ 供应商需要的配置文件（每次启动重写）
    └─ runs/                     每次运行的日志（超过 14 天的启动时自动清）
```

所以删一个项目就是删它的文件夹，不会留下孤儿；备份、迁移、查看一个项目的全部历史也只看这一个文件夹。`global/` 里是整台机器共用的，删项目不会动它。守护进程用「执行者名字」（`<项目>~<执行者>`，调度器是 `<项目>~@dispatcher`）找到它属于哪个项目。`data/` 整个删掉也不会让系统坏掉，会按需重建，但供应商和预检清单要重新配。

**测试与脚本**（`packages/agentd/`）：

- `test/unit/`：不启动进程，或用假的 CLI。每个测试第一行引入 `test/lib/isolate.mjs`：数据目录和系统临时目录都指进它自己的文件夹，测试结束整个删除，不会写进真实的 `data/`，也不留临时文件。
- `test/live/`：需要守护进程或真实 CLI/模型。`npm test` 就是用 `scripts/run-isolated.mjs` 在私有守护进程上跑整套（`test:all`），也可以只跑指定几组；跑完私有的数据目录和临时目录整个删除。直接对共享的守护进程跑单个测试会在它的 `data/` 里留下测试用的项目和对话记录，不要这样做。
- `test/lib/scheduler.mjs`：测试共用的连接封装，也是「前端怎么用 agentd」的参考。
- `scripts/restart-daemon.mjs`：让守护进程用上新代码（`npm run restart-daemon`）。
- `scripts/run-isolated.mjs`：私有的数据目录、临时目录和管道，跑整套或指定的测试，跑完整个删除。
- 各 CLI 的行为探针（规则、MCP、恢复会话）随驱动放在 `packages/drivers/probes`，由 `preflight probe` 运行。

---

## 一次运行的时序

```
extension          daemon              AcpClient            agent
    │                 │                    │                  │
    ├─ run(async) ───►│                    │                  │
    │                 ├─ startPrompt ─────►│                  │
    │                 ├─ subscribe(sock)   │                  │
    │                 ├─ publish job.started│                  │
    │◄── {jobId} ─────┤                    │                  │
    │                 │                    ├─ session/prompt ►│
    │                 │◄─ progress(500ms) ─┤                  │
    │◄─ progress ─────┤                    │                  │
    │                 │                    │◄─ stopReason ────┤
    │                 ├─ receipt = append()│                  │
    │                 ├─ publish job.done  │                  │
    │◄── job.done ────┤                    │                  │
    ├─ renderResult   │                    │                  │
```

关键点：

- **订阅在运行开始之前**：`run {subscribe: true}` 让 daemon 在返回 jobId 前就注册好 socket，
  避免「跑完了才订阅」丢事件。
- **回执先写盘再广播**：`job.done` 事件里的 `receipt` 已经带着自己的 `eventId`。
- **每个 agent 一个串行队列**：ACP 一个连接一次只能跑一个 prompt，不同 agent 可以并行。

---

## 事件模型

### 身份

```
{"id":"094fab8e-2","seq":2,"epoch":"094fab8e","event":"job.done", ...}
```

- `epoch`：daemon 启动时生成，重启即变 → 旧 id 会被识别为过期
- `seq`：单次生命期内单调递增

### 持久 vs 瞬时

| 事件 | 有 id | 进环（可重放） | 说明 |
| --- | --- | --- | --- |
| `job.started` | ✓ | ✓ | 任务开始 |
| `job.done` | ✓ | ✓ | 正常结束或失败（带 `result` 或 `error`） |
| `agent.exit` | ✓ | ✓ | 进程异常退出（无 jobId，广播给所有连接） |
| `progress` | ✗ | ✗ | 累计字符数快照，重放无意义 |

正文的持久形态是 `data/projects/<项目>/runs/<jobId>.log`，不是进度事件。

### 投递规则

```
有 jobId  → 该 job 的订阅者 + 订阅了 '*' 的连接
无 jobId  → 所有连接（系统事件）
```

### 续传

```json
{"op":"events.since","args":{"afterId":"094fab8e-1","limit":50}}
→ {"reset":false,"epoch":"094fab8e","events":[...],"hasMore":false}
```

`reset: true` + `reason: "epoch-mismatch"` 表示 daemon 重启过，调用方应改为读
`receipts.jsonl`。环上限 2000 条，更早的历史同样从 receipts 读。

历史（receipts）、缺口（环）、增量（实时推送）三段各管一件事，互不重叠。将来做 Web
看板时，SSE 的 `id:` 直接映射事件 id，`Last-Event-ID` 直接传给 `events.since`。

---

## 会话模型

每个 agent 维护：

| 状态 | 作用 |
| --- | --- |
| `sessionId` | 当前活跃会话 |
| `live: Set` | 本进程内已存活的会话 |
| `sessionConfig: Map` | 每个会话的 configOptions 缓存 |
| `queue` | 串行闸门 |

### 切换的三条路径

| 路径 | 触发 | 相对成本 |
| --- | --- | --- |
| live switch | 会话在 `live` 里 | 纯指针替换，不发 RPC |
| disk resume | 会话来自别的进程 | 一次 `session/resume` |
| 冷启动 | 进程还没起 | spawn + initialize + `session/new` |

`session/resume` 必须带 `cwd`，两个原生 agent 都一样。

### 为什么需要 `live: Set`

dsh 新建会话时不会关闭上一个，多个会话可同时处于「活跃」状态；对它再 resume 会报
`session is already active`。如果不处理，`sessionId` 还指向旧的，会**静默地答错会话**。
`live` 命中时只换指针，不调 resume。

### 标签

三个 agent 都没有 rename API（`session/set_title`、`session/rename` 等均 Method not found），
所以标签是本地 sidecar：`data/projects/<项目>/session-labels.json`，展示时与 agent 自带的 title 合并，
标签优先。

---

## 模型

ACP 没有 `session/set_model`（也没有 `set_mode`）。实际接口是：

```
session/set_config_option { sessionId, configId, value }
```

| agent | configId | 值格式 |
| --- | --- | --- |
| mcode | `model` / `thinkingEffort` / `permissionMode` | `m:provider:model:v:variant` |
| dsh | `model` / `reasoning_effort` | JSON 数组字符串 |
| pi | `model` / `thinking` | `provider/modelId` |

值格式完全不同，所以只透传不解析。`describeModels()` 统一把嵌套/分组的 options 拍平，
上层只看到扁平的 `{value, name}`。

### 持久化补偿

mcode 原生保留模型选择；dsh 和 pi 重启后回退默认。所以 pool 在 sidecar 里记一份，
`_attach` 时对比差异并重新推送。

---

## 健康信号

agent 不参与，全部由调度器推断：协议结果、自己的计时器、agent 上报的上下文占用。

```
run_failed / timeout / forced_stop / refused / agent_restarted   → error
context_pressure / cancelled / empty_output        → warn
slow_run                                           → info
```

每次运行产出 `health` + `attention[]`，随 `job.done` 和回执一起落地。
`attention[].source` 目前恒为 `system`，这个字段是给将来「agent 主动上报」预留的。

`durationHistory` 每个 agent 保留最近 20 次，用于判断 `slow_run`（超过 p95 两倍）；
它只在运行结束时写入，读取指标不会污染基线。

### 超时、取消与强制结束

先礼貌地问一下，不行就杀掉（思路同 Celery 的软超时 / 硬超时）：

```
执行者沉默 5 分钟（`timeout`；正在跑的工具调用不算沉默）  或  总时长超过 2 小时  或  一个工具调用开着、执行者 10 分钟没有任何动静（`limits.stuckToolMin` / `AGENTD_STUCK_TOOL_MS`；多半是前台跑了开发服务器这类不会结束的命令，取消时在报错里点出命令，并提醒它留下的进程可能还在）
  → 发 session/cancel                       软超时：请它停下来
  → 等 15 秒（AGENTD_CANCEL_GRACE_MS）
  → 它结束了：任务记为 timeout
  → 还没结束：杀掉整棵进程树（Windows 用 taskkill /T /F），任务记为 timeout + forced
下一次派发：自动重启进程，回到同一个会话
```

- 只杀直接子进程不够：适配器、真正的 CLI、它启动的工具是三层进程，卡住的构建会留下来。
  `test/unit/forced-stop-test.mjs` 用「脱离父进程的孙进程」验证这一点。
- 强制结束不算崩溃：不发 `agent.exit`，发 `agent.forced-stop`（带次数）。
- 每个任务有明确终态 `outcome`：`done / failed / timeout / cancelled`（另有 `unstable`，见下），
  回执的 `status` 取自它；`forced` 表示是靠杀进程收尾的。
- 熔断：同一个执行者 30 分钟内被强制结束 3 次，就标记 `unstable`，之后的派发立刻失败并说明原因，
  不再启动进程，直到人点「恢复」（`POST /api/agents/:id/recover`，调度器无权调用）。
  次数和窗口在 `agentd.config.json` 的 `limits.forcedStopLimit` / `limits.forcedStopWindowMin`。
- 强制结束可能让一次文件写入停在一半；错误信息会提醒调度器先检查再重派。
- 取消按运行（`jobId`）：`cancel` 带 `jobId` 时只动那一个——还在排队的在开始前直接摘掉（结果为 `cancelled`，不会到 CLI），
  正在跑的发 `session/cancel`，已经结束的什么都不做。不带 `jobId` 还是取消该执行者当前在跑的那个。
  调度器被中止时只取消**它自己发出的**任务（包括排队的），不再误动别的任务。
- 取消也有硬收尾：CLI 在宽限期内不响应，同样结束进程（结果为 `cancelled` + `forced`）。
  pi 适配器以前根本没实现 `session/cancel`（停止对 pi 执行者是空操作），现在转成 pi 的 `abort`，以 `stopReason: cancelled` 结束。

### 守护进程中途停止：在途任务不能凭空消失

回执在任务**结束**时才写，所以守护进程在任务运行中被重启或崩溃，原本不会留下任何痕迹。
做法是先记下来，重启后对账（思路同预写日志）：

- **派活默认异步**：`agent_run` 不带 `wait` 时，扩展只调 `run`（`async: true, report: true`）就返回，调度器这一轮可以结束；任务由 agentd 跟着，结束时 `daemon/reports.mjs` 把答案作为一条用户消息交给调度器，开新的一轮。带 `wait: true` 才在本轮里等。人取消的任务只列在下一条回报里，不单独叫醒调度器。
- `core/records/journal.mjs` 把每个任务交出去时记一条 `start`，结束时记一条 `end`（`data/projects/<项目>/journal.jsonl`，追加式）。
- 守护进程启动时读一遍：有 `start` 没有 `end` 的就是上一个进程没做完的（排队中或运行中），
  补写一条 `interrupted` 回执，发 `job.interrupted` 事件，然后清空日志，每个任务只报一次。
- 每个执行者记住自己最近一次被中断的任务（`data/projects/<项目>/interrupted.json`），直到它收到新任务才清掉；
  它出现在实例行的 `interrupted` 字段里，界面标题栏显示「上次任务因服务重启被中断」，
  调度器每一轮的系统提示里也会看到这一条，和 `unstable` 一起。
- 执行者自己的对话里也要看得到：启动对账时，在它那次任务所在的会话（按任务号在会话记录里找）末尾追加一条 `error` 条目（`interrupted: true`），网页显示为「被中断」，不带用时。
- 调度器对话里，派发那一行没有结果、而调度器此刻不在工作（`dispatcher.busy` 为假），就不可能还在进行——显示「已中断：没有收到结果」，展开有说明。
- 只记录和通知，不自动重跑：执行者可能已经写了一半的文件，重不重派由调度器或人决定。
- 尚未做：调度器自己正在进行的那一轮（对话里留下一个没有结果的工具调用）不在这套记录里。

### 长回复不能撑满调度器

调度器拿到的每一段内容都会一直留在它的对话里。执行者一次贴出几万字（整份文件、长日志），调度器就被撑满。

- `core/records/reply.mjs` 的 `fitReply`：回复不超过 6000 字符（`AGENTD_REPLY_CHARS`）原样给；
  超过则全文存进 `data/projects/<项目>/results/<jobId>.md`，调度器只收到开头、结尾，和「省略了多少字、全文在哪个文件」的提示。
- 只在给调度器的那一层裁剪：网页、会话记录、`run` 操作的返回仍然是全文。
- 文件夹只保留最新 200 个。
- 这也是「用文件传递大量信息」的兜底：调度器想看中间部分可以自己读那个文件。

### 任务身份与重试上限

`jobId` 是一次运行。同一件事失败后再发，要能认出它们是同一个任务，并且不能无限重试：

- `core/records/tasks.mjs`：每次运行归入一个任务（`taskId`），带第几次尝试（`attempt`）和重试的是哪一次运行（`retryOf`）。
  任务状态在 `data/projects/<项目>/tasks.json`，重启后仍在。
- 怎么认出是重试（不依赖调度器配合）：
  1. `agent_run` 的 `retry_of` 参数给出上一次的任务号或运行号；
  2. 或者同一个执行者在失败后 30 分钟内收到**同样的提示词**（空白不影响）。
- 只有 `failed / timeout / interrupted` 算失败；`done` 和 `cancelled` 结束任务；被熔断拒绝的（`unstable`）不算。
- 失败满 3 次（`limits.maxAttempts`）后不再发出：`run` 直接抛 `retry-limit`，
  告诉调度器「不要再重试，把情况告诉用户」，执行者不会启动。**上限只对调度器**（请求带 `caller: "dispatcher"`）；
  人直接发同样的消息，当作新任务，并关闭之前失败的那条链，不会被拦。
- 调度器每次拿到结果或失败，末尾都有一行 `[task …, attempt n of 3, job …]`，要重试时照抄这个号。
- 字段进了：回执、`job.started` / `job.done` 事件、任务日志、执行者会话记录的每一条。
- 网页：调度器对话里，派发给执行者的任务是一行（派发给谁、任务摘要、第几次尝试、状态），点开看任务全文和回复；
  执行者的会话里，重试发来的那条消息下面标「第 n 次尝试」。
- 排队：一个执行者一次只跑一个任务，后来的在它后面等（先进先出）。**调度器也一样**：它正在做一轮时再发消息，消息排队，
  这一轮结束后按顺序发下一条（先不做「插话」）；排队的消息在对话下面显示「排队中」，可以单独取消；停止当前这一轮会把排在后面的一起丢掉。
  守护进程重启，排队的消息丢失。`startPrompt` 返回 `ahead`（前面有几个），`job.started` 带 `queued / ahead`，
  真正开始时发 `job.running`。网页里排队的派发行显示「排队中（前面还有 N 个）」，用时从真正开始算；
  页面是任务中途打开的，用执行者那一行的 `waiting`（排在运行中那个后面的个数）判断：它的未完成派发里最新的 `waiting` 个是排队的。
- 尚未做：任务视图（列出所有任务和尝试链）。

### 执行者在干什么要看得见

一个任务跑几分钟，界面上不能是一片安静，否则分不清是在干活还是挂了。

- **pi 适配器**（`pi-adapter/acp-adapter.mjs`）原来只转发回答文字，工具调用和推理全被丢掉。现在把 pi 的
  `tool_execution_start / update / end` 转成 ACP 的 `tool_call / tool_call_update`，`thinking_delta` 转成
  `agent_thought_chunk`。下游本来就会处理它们：写进会话记录（网页里显示工具调用），也算作「有动静」，
  所以长时间跑工具的 pi 执行者不会再被沉默超时误杀。
- **进度事件** `progress` 现在带 `agent`、最近一个工具（`tool`）、工具调用次数、未结束的工具数；
  工具开始时立刻发一次，不再只在文字到来时发。
- **网页**：任务进行中只显示一件事——总用时（「进行中 · 已用时 1 分 47 秒」的形式，调度器对话里派发的那一行和执行者标题栏都是）。
  不再推断「没有新动静」「思考中」之类的状态：它们靠事件间隔猜，会猜错，反而让人慌。
  做了什么交给下面的工具调用和思考过程去看。页面是任务中途打开的，也能从执行者那一行的 `activity.startedAt` 算出用时。
- **看得到内部**：会话记录里工具调用带 `input`（给了它什么）和 `output`（它返回了什么，截断），
  推理文字存成 `thought` 条目（上限 12000 字）。网页里工具调用点开能看输入和输出，
  执行者的回复前有一个默认收起的「思考过程」。
- **用时**：调度器对话里，派发那一行结束后保留「用时 …」；一次调度器对话（用户一句话到最后一个回复）
  在回复下面标「本轮用时」，时间取自调度器会话文件里每条记录的落盘时间
  （pi 消息自带的时间是开始时间，不能用来算结束）；执行者的每个回复下面标「用时」（提示词记录到回复记录之间）。
- 工作中的圆点用呼吸动画（放大、发光、变淡，`@keyframes breathe`），减少动效偏好下改为静态光环。

### 失败：谁报的，原样告诉人

不做细分类，也不自动重试，两条规则：

- **agentd 自己产生的失败**（超时、被强制结束、被中断、进程退出、被取消、熔断、重试上限）：agentd 报，写明是 agentd 报的。
- **CLI 自己报的错**（它返回的 JSON-RPC 错误，比如额度用完、未登录、模型不存在）：**原文转发**，不改写、不猜类别，写明是 CLI 报的。
- 两者都由人来决定下一步。调度器收到失败时，规则要求它把原因和来源如实告诉用户并等待，不自己重试、不换执行者重做；
  用户明确要求重试时才重新派发（带 `retry_of`，上限 3 次仍然有效）。
- 记录：运行结果和回执里的 `failureSource` 是 `agentd` 或 `cli`（成功时为空）。

### pi 的两条通路共用一个客户端

调度器（`core/dispatcher/`）和 pi 适配器（`pi-adapter/acp-adapter.mjs`，单独的进程）以前各自带一份和 `pi --mode rpc`
通话的代码，两份写得不一样：调度器取上下文统计时多拆了一层 `data`（占用环一直空），适配器没实现 `session/cancel`
（停止 pi 执行者是空操作），只有适配器会压缩。现在都用 `core/pi/rpc.mjs` 的 `PiRpc`：启动与停止、命令与回复按编号对应并带超时、
一轮的开始与结束、事件监听、一组带名字的命令（状态、统计、压缩、中止、新会话、换模型……）。各自特有的留在各自那边
（调度器：会话文件、排队、用时；适配器：ACP 翻译、会话编号对应）。

### 调度器的压缩与交接（和执行者同一套规则）

- **压缩**：项目设置里给调度器设一个大小（`PATCH /api/projects/:id/dispatcher`，K tokens，**默认关闭**），一轮结束、空闲时检查，
  超过就让 pi 压缩；规则和执行者共用 `compactIfNeeded`（不在忙时压、压完没变小不立刻再压、失败不记录）。
  压缩期间发来的消息排队，压完再发。压缩后 pi 会有一段时间报不出新的占用，下一轮才有数。
- **pi 的压缩有下限**：它只压缩最近约 20K tokens 之前的部分，并且不能从一条消息中间切开。会话没有那么大，或者几条超大的消息撑起来的，
  压不下来（`Nothing to compact (session too small)`）；所以设置建议不低于 50K。这条对 pi 执行者同样成立。
- **交接**：调度器也可以被系统提议换新会话（压缩满 3 次时），在交接里叫 `@dispatcher`；交接文档是它自己的回复，你确认后开新会话、
  新会话第一条消息带文档，旧会话保留。新会话由 pi 在第一条消息时才写文件，所以起名不要求文件已存在。
- 调度器不能改自己的压缩设置（和交接的生成、确认一样，只有人能做）。

### 执行者对话里的文字、推理和工具调用，按发生的顺序

- 以前一次运行的文字只在**结束时**写成一条，排在所有工具调用之后；推理也是一条。网页因此看不出"先说了什么、再调了什么"。
  现在每次**工具调用开始时**，先把之前说的话和想的东西写成一条（`assistant` 带 `piece: true`，`thought`），再写工具调用；
  运行结束时写最后一条 `assistant`（只含剩下的文字，总带着怎么结束的；最后一步是工具调用时文字为空）。每条带 `startedAt`（它开始的时刻）。
  返回给调用方的回复仍是整段文字。
- `tail` 多给 `pendingText` / `pendingThought`：还没写进记录的那一段，网页拿它画「活的末尾」。
- 网页的 bug：以前每 1.5 秒取一次「这次运行到现在的**全部**文字」，如果最后一项不是实时文字就新建一个气泡；而同一轮里工具调用的记录会排到它后面，
  所以每一轮都新建一个，里面装着完整的累计文字，看上去就是同一句话一遍遍重复。现在活的末尾只有一个位置，每次整体替换，只放还没进记录的那一段。
- 进入一个正在工作的执行者，活的末尾马上就有，不用等第一次刷新。
- 每条消息显示开始的时刻（调度器的取 pi 消息自带的开始时间，执行者的取这一段的 `startedAt`）；你发出的消息还会标「已收到」。
- 对话末尾有一行状态：调度器是它自己报的事件（思考中、正在回复、等待某执行者的结果、正在使用某工具），执行者是「处理中」，都带从发消息起的用时。
- 往上翻页时出现「回到最新」按钮。

---

## 协议映射

### 对 agent（ACP）

用到的方法：`initialize`、`session/new`、`session/list`、`session/resume`、
`session/prompt`、`session/set_config_option`、`session/cancel`（通知）。

接收的通知：`agent_message_chunk`、`agent_thought_chunk`（只计入活动信号，不进正文）、
`usage_update`、`config_option_update`。

### pi 适配器（ACP ↔ RPC）

pi 没有 ACP，官方集成方式是 `pi --mode rpc`。适配器负责翻译：

| ACP | pi RPC |
| --- | --- |
| `session/new` | `new_session` + `get_state` |
| `session/list` | 本地注册表（pi 无 list 命令） |
| `session/resume` | `switch_session {sessionPath}` |
| `session/prompt` | `prompt` → 等 `agent_settled` |
| `session/set_config_option` | `set_model` / `set_thinking_level` |
| `session/update` 通知 | `message_update` 的 `text_delta` |
| token 指标 | `get_session_stats` |

两个必须的设计：

- **`--no-mcp --no-extensions`**：内层 pi 若加载同一个项目配置，会连回调度器形成递归；
  `--no-extensions` 还避免它发出本适配器无法渲染的 UI 请求。
- **session id 用文件名**：pi 的 `get_state.sessionId` 是进程级的（换进程就变），
  只有 session 文件名稳定。

---

## 状态归属

| 东西 | 归谁 | 我们做什么 |
| --- | --- | --- |
| 对话历史 | 各 harness 的磁盘 | 不碰，只要求 resume |
| 会话 id | harness 生成 | 记录 + 映射 |
| 对话内容（经 agentd 的） | 我们（`data/projects/<项目>/transcripts/`） | 追加记录 |
| 调度器对话历史 | pi（`data/projects/<项目>/dispatcher-sessions/`） | 不复制，按需读取 |
| 项目清单（根目录、实例、角色） | 我们（`data/projects/<项目>/project.json`） | 持久化 + 启动时恢复；删项目就是删它的文件夹 |
| pi 的 LLM 清单 | pi（`models.json`） | 显式命令才写，写前备份 |
| 活跃会话指针 | 我们（连接内） | 持有 |
| 标签 / 模型选择 | 我们（sidecar） | 补 harness 的缺口 |
| job / 进度 / 回执 | 我们 | 生成、持久化、广播 |
| agent 进程 | 我们 | 起、重启、关闭 |
| 工作区文件 | **用户** | 不写（见守则） |

---

## 会话与权限规则

- **执行者的目录创建后只读**：要换目录就新建执行者（`projects.updateInstance` 拒绝改目录）。
- **调度器可以新建、命名、切换执行者的会话**（一个会话对应一个模块 block，见 `contexts/project.md`；工具
  `agent_session_new / agent_session_use / agent_session_rename`），但**删除会话、重置会话、改目录**只有人能做。
  `daemon/guard.mjs` 对带 `caller: "dispatcher"` 的请求拒绝这些操作，扩展里也没有对应工具。
- **压缩**：每个执行者可设阈值（`compactAt`），由 agentd 在一个回合结束、执行者空闲时检查，超过就让 CLI 自己压缩
  （`/compact`；mcode、pi 支持，dsh 没有）。同一个会话内进行，不换会话。
- **交接**：换新会话，和压缩是两回事，上下文占比本身不触发。调度器只能 `propose_handoff`；系统也会在客观信号
  （同一会话压缩 ≥3 次、连续失败 ≥3 次）出现时自动提出。之后必须由人：生成交接文档 → 查看并可修改 →
  确认，才会开新会话。交接文档由执行者直接作为回复交出（提示词在 `contexts/handoff-write.md`，开新会话那条在 `handoff-start.md`，
  都只在交接那一步发出、每次现读；不再用 skill 文件，也不写进执行者目录），
  副本留在 `data/projects/<项目>/handoffs/`；新会话的第一条消息里带着这份文档。
- **支持的 CLI**：mcode、dsh、pi、opencode（原生 ACP）、claude 和 codex（经官方适配器 `@agentclientprotocol/claude-agent-acp`、`codex-acp`，全局安装在 Node 目录）。注册表在 `core/pool/config.mjs`；claude 用 `CLAUDE.md`、技能放 `.claude/skills`，opencode 技能放 `.opencode/skills`，codex 与 dsh、pi 一样用 `.agents/skills`。opencode 的 `/compact` 虽不在 ACP 的命令列表里，但可用（实测占用 8512→806）。
- **规则**：不写进项目（没有 AGENTS.md、CLAUDE.md、skills），通过各 CLI 的额外系统提示入口交：mcode 启动参数、pi 启动参数、
  claude / codex 的 `session/new` `_meta`、opencode 的配置环境变量，dsh 没有入口，放在每个会话第一条消息前面（压缩后再补一次）。
  六种都实测过：新会话、恢复会话后都生效（`npm run preflight -- probe`、`test/live/rules-live-test.mjs`）。
- **MCP 服务器**：每个实例可带一组（`core/pool/mcp.mjs`），agentd 不知道它们是什么，只在每次 `session/new` 和 `session/resume` 的 `mcpServers`
  里交给 CLI（只在 `session/new` 里给不够：实测 resume 不带就不加载）。pi 没有这个参数，走环境变量 `AGENTD_MCP_SERVERS` 和 `pi-adapter/mcp-bridge.ts`。
  配置里的 `env` / `headers` 不进状态输出，调度器不能创建实例或改它们。六种都实测过（`npm run preflight -- probe`、`test/live/mcp-live-test.mjs`）。

---

## 设计守则

四条，用来防止项目从「调度器」漂成「harness」。

**1. 只观测，不改写**

不写 agent 的工作区，不替换它的系统提示，不改写对话内容。
这条排除了：往项目里写 AGENTS.md / CLAUDE.md / skills、覆写（替换）system prompt、改写对话内容。
**唯一的例外**是规则：启动时给 agent **追加**一段额外系统提示（只加不换，agent 自己的提示和项目自己的 AGENTS.md 照旧生效）。
这是 2026-10-23 决定的：写文件会干涉项目，而且项目已有 AGENTS.md 时我们的规则根本不生效。

**2. 只补它没有的**

harness 自己能做好的，我们不做。每项状态都必须对应某个 harness 的缺失：

| 我们持有的 | 因为谁缺 |
| --- | --- |
| 会话标签 | 三家都没有 rename API |
| 模型持久化 | dsh / pi 重启后回退默认 |
| `live: Set` | dsh 多会话同时活跃 |
| 回执 / attention | ACP 不给 token、不给运行记录 |
| 每 agent 的 cwd | 没有统一的启动目录概念 |

哪天某个 harness 自己做了，我们这份就该删。

**3. 不替它做事**

能靠 prompt 让 agent 完成的，不在 hub 里实现。不解析/改写 agent 的输出，
不替它做文件操作，不替它做决策。

**4. 对工作区的写入必须是显式命令**

任何改动磁盘的操作都要人显式触发，**永不在运行路径上**。
运行路径只有：起进程、发 prompt、取消、读写我们自己的 `data/`。

---

## 边界与限制

- **同 agent 串行**：协议限制，不是实现选择
- **流式粒度取决于 agent**：dsh 只发一个 chunk
- **token 只有 pi 有**：另外两家的协议不提供
- **标签只在本地**：不写回 harness
- **pi 适配器 cwd 固定**：工作目录在进程启动时确定
- **无 `session/close`**：切过的会话会留在进程内存里
- **对话记录不含 agentd 之外的会话**：直接在 CLI 里聊的内容我们看不到
- **改 models.json 要重启调度器**：pi 只在启动时读取该文件；调度器忙时拒绝修改

## SpecLock Core（规格库）

Core 是一个独立的服务，agentd 不改它的代码，只通过它的 REST 和 MCP 用它。**所有项目共用一个 Core 实例**，项目之间由 Core 自己隔离（每把 key 绑定一个 Core 项目）。

- **位置**：Core 的数据在 `data/global/.speclock/`（Core 自己的目录名），超级管理员 key 在 `data/global/specs.json`，只有 agentd 读；每个项目在 Core 里的 id 和项目管理员 key 在 `data/projects/<id>/specs.json`。Core 的代码默认在仓库旁边的 `speclock-core/`（`AGENTD_SPECLOCK_DIR` 或 `agentd.config.json` 的 `speclock.dir` 可改），用它自己的 `.venv`（第一次用到时 `uv sync` 建好）。
- **生命周期**：第一次有人给执行者选了规格角色时才初始化、启动；之后每次 daemon 启动自动带起，daemon 退出时一起停。端口默认 47821（`AGENTD_SPECLOCK_PORT`）。
- **角色**：执行者创建或编辑时单独选「规格角色」（需求 / 执行 / 测试 / 扫描 / 不接入），和模板无关：模板决定它怎么干活，角色决定它在规格库里能做什么。选了之后 agentd 用超级管理员 key 在 Core 里（需要时先建项目）给它建一把**绑定本项目**的 key，Core 把 key 存成自己目录里的文件；执行者拿到的 MCP 配置里只有文件名，不经过任何模型。换角色换 key，删执行者吊销 key。
- **提示词**：`contexts/spec/` 里是脚手架自己写的规格库提示词（通用部分 + 四个角色），拼在执行者的规则后面。它们是按脚手架的环境写的，不是 Core 的 `roles/` 原样搬来。
- **代码**：`core/specs/` 是唯一知道 Core 接口的地方（`client` 调 REST，`service` 管进程，`provision` 管项目和 key）。测试：`npm run test:specs`（用真的 Core，没有就跳过）。
- **调度器**：项目在 Core 里有了位置之后，调度器的 pi 进程用 pi 内置的 MCP 客户端加载 Core 的 MCP（和 pi 上的执行者同一套办法），身份是项目管理员：能批准 / 驳回本项目的审核单、查待办和动态，别的做不了。钥匙存成 `data/projects/<id>/specs-admin.key`，配置里只有路径。批准的流程和「必须是用户原话」写在 `contexts/project.md` 的「规格库」一节，靠提示词约束（Core 要求带原话但不判断真假）。批准之后调度器直接派需求执行者提交 Commit，需求执行者的回报走现有的回报机制叫醒调度器，所以不需要另外轮询 Core。
- **花名册**：调度器每轮看到的名单里带每个执行者的规格角色和职责。
- **一个模块几个人做**：Core 的一条待办（模块的一个版本）只能有一个人领取并提交，所以调度器派活时指定一个**负责人**（实现业务规则和接口的那个执行者，通常是后端；负责人只在派活时说明，不写进规格库），其他人是**参与者**：用 `get_work` 读规格，不领取不提交，回报时写覆盖的验收条件和证据。调度器核对接口契约和验收条件的覆盖后，把参与者的回报原话转给负责人，由他汇总提交。提交后记录是「已实现」（自测齐全），要不要做端到端验收由用户决定，测试通过后才是「已验收」。这套办法不改 Core；如果界面相关的验收条件多到转达变得别扭，再请 Core 支持多人共同领取。
