# SpecLock Scaffold

SpecLock 的调度脚手架：在一台机器上调度多个 CLI agent。**一切都依托项目**：先有项目，项目里才有执行者和调度器；没有项目，什么都不工作。
规格本身（版本、审核单、权限）由独立的 [SpecLock Core](https://github.com/leaveWhite9088/speclock) 负责，本仓库不含 Core 代码。

```
看板 ──► 项目的调度器（pi + 扩展） ──►  agentd（常驻单例）  ──ACP──►  项目里的执行者：mcode / dsh / opencode / claude / codex / pi
```

| agent | 是什么 | 怎么接入 | 版本（实测） | 启动目录 |
| --- | --- | --- | --- | --- |
| `mcode` | MiniMax Code | 原生 ACP | `@minimax-ai/code` 0.7.6 | 项目里的一个子目录 |
| `dsh` | DeepSeek Harness | 原生 ACP | `@deepseek-ai/dsh` 0.1.5-rc.2 | 项目里的一个子目录 |
| `opencode` | OpenCode | 原生 ACP（`opencode acp`） | `opencode-ai` 1.19.1 | 项目里的一个子目录 |
| `claude` | Claude Code | 官方适配器 | `@agentclientprotocol/claude-agent-acp` 0.94.0 + `@anthropic-ai/claude-code` 2.1.295 | 项目里的一个子目录 |
| `codex` | Codex | 官方适配器 | `@agentclientprotocol/codex-acp` 2.2.2（依赖 `@openai/codex` 0.160.1；本机另装的 codex-cli 为 0.163.0） | 项目里的一个子目录 |
| `pi` | 另一个 pi 实例 | 自带适配器 `pi-adapter/acp-adapter.mjs`（走 pi 的 RPC） | `@earendil-works/pi-coding-agent` 1.3.0 | 基准目录 |

版本是 2026-10-23 在本机（Windows 11、Node v24.19.0）实测时安装的，升级后行为可能不同。
claude 的接口地址、模型和密钥读取你自己的 `~/.claude/settings.json`（cc-switch 切换后，下次启动进程时生效）。

### 各 CLI 能看到什么（实测）

一个执行者干活时，界面上能看到它的哪些内部过程。方法：每种 CLI 各让它用工具创建一个文件，再读它的会话记录（会调用真实模型）。

| CLI | 工具调用 | 输入 | 输出 | 思考过程 |
| --- | --- | --- | --- | --- |
| mcode | ✓ | 没有 | ✓ | 这次没有 |
| dsh | ✓ | ✓ | ✓ | ✓ |
| opencode | ✓ | ✓ | ✓ | 这次没有 |
| claude | ✓ | ✓ | ✓ | ✓ |
| codex | ✓ | ✓ | 只有退出码 | 这次没有 |
| pi | ✓ | ✓ | ✓ | ✓ |

- **mcode** 的协议不提供工具的输入，只有标题和输出。
- **codex** 的命令在终端里执行，输出不经过协议，只能拿到退出码。
- **思考过程**取决于模型有没有输出推理；任务很简单时有的模型不写，所以「这次没有」不等于「不支持」。
- opencode、claude 的参数和可读标题在工具开始之后的更新里才给，agentd 会把这些更新合并起来再写进记录。
- 只有这些改动之后的运行才有这些详情，旧的运行记录里没有。

### 给 agent 的规则怎么交进去（实测）

规则（执行者能做什么、不能做什么、怎么汇报）不写进你的项目，不碰项目自己的 `AGENTS.md` / `CLAUDE.md`，
而是启动进程或开会话时，通过各个 CLI 自己的「额外系统提示」入口交给它。规则文本放在 agentd 自己的 `data/projects/<项目>/rules/` 下。
探针：`npm run preflight -- probe`（驱动自带的行为探针，见下面「驱动与预检」）（给每种 CLI 一条「每次回复结尾加暗号」的规则，
在空目录里问两次：新会话一次，进程停掉再恢复会话一次）。

| CLI | 入口 | 新会话 | 恢复会话后 | 项目里留下的文件 |
| --- | --- | --- | --- | --- |
| mcode | `mcode acp --append-system-prompt-file <文件>` | ✓ | ✓ | 0 |
| pi | `--append-system-prompt <文件>`（适配器加到 pi 命令行） | ✓ | ✓ | 0 |
| claude | `session/new` 的 `_meta.systemPrompt.append` | ✓ | ✓ | 0 |
| codex | `session/new` 的 `_meta.jetbrains.air.customInstructions` | ✓ | ✓ | 0 |
| opencode | 环境变量 `OPENCODE_CONFIG_CONTENT` 里的 `instructions` | ✓ | ✓ | 0 |
| dsh | 没有入口：规则放在每个会话第一条消息前面（压缩后再补一次） | ✓ | ✓ | 0 |

这只验证了「规则能送到、重启后还在」，用的是一条很简单的规则；复杂规则（比如「不要 git push」）遵不遵守，
取决于模型，而且规则始终是提示词层面的约束，不是强制。

架构见 [ARCHITECTURE.md](ARCHITECTURE.md)，踩过的坑和实测数据见 [LESSONS.md](LESSONS.md)。

## 仓库结构（npm workspaces）

| 包 | 作用 |
| --- | --- |
| `packages/agentd` | 调度器：daemon、agent 池、pi 扩展、调度器 pi、测试。以下大部分内容都在讲它 |
| `packages/drivers` | **每个 CLI 特有的东西，一个 CLI 一个文件**：怎么启动、规则和 MCP 怎么交、哪些版本验证过、有哪些能力。没有依赖；其余部分问「能力」，不问「你是哪个 CLI」。升级某个 CLI 时改的主要就是它的驱动 |
| `packages/preflight` | **预检**：找出本机装了哪些 CLI、和驱动验证过的版本对照、（可选）把验证过的版本装进脚手架自己的目录。在 daemon 之外运行，只产出一份清单给 daemon 读 |
| `packages/backend` | 薄网关：HTTP + SSE，每个路由对应 agentd 的一个操作，自己不存状态 |
| `packages/web` | 看板：React + TypeScript + Vite（Tailwind、Radix/shadcn 风格组件、TanStack Query、Zustand）；开发服务器把 `/api` 代理到 backend，`npm run build -w @speclock-scaffold/web` 构建 |

```powershell
npm install            # 仅用于建立 workspace 链接，没有第三方依赖
npm run backend        # http://127.0.0.1:8787（`BACKEND_PORT` 可改），首次请求时自动拉起 agentd
npm run web            # http://127.0.0.1:5234，打开这个（环境变量 `WEB_PORT` 可改）
npm run preflight      # 检查本机的 CLI（只读，什么都不改）
npm test               # drivers、preflight、agentd、backend 全部回归
npm test -w @speclock-scaffold/backend   # 网关测试
```

backend 只监听 `127.0.0.1`，并拒绝非本机的 Host / 跨站 Origin：它能运行 agent、改 pi 的 `models.json`，不要对外暴露。
命令中的路径（`scripts/`、`test/`、`data/`、`agentd.config.json` 等）都相对 `packages/agentd`。

---

## 安装

不需要把扩展装进 pi：agentd 启动一个项目的调度器时，会用 `pi -e` 自己加载 agent-router 扩展，只在那个调度器进程里生效。
没有 `AGENTD_PROJECT`（也就是不是 agentd 为某个项目启动的 pi）时，这个扩展什么都不注册。

前置条件：`node` 在 PATH 上；要用的 CLI 已安装；要用规格库的话再需要 `git` 和 `uv`，然后运行一次 `npm run preflight -- core --yes` 下载 Core（脚手架不会自己联网下载）。`npm run preflight` 会告诉你本机装了哪些、版本对不对（见下面「驱动与预检」）。
daemon 由客户端按需拉起，不需要手动起服务。

---

## 怎么用

1. 打开看板（`npm run backend`、`npm run web`），**先建项目**：一个根目录。
2. 在项目里**建执行者**：选 CLI 类型、项目内的一个子目录、用途。可以用「模板」预填。
3. 对项目的调度器说话，由它决定派给哪个执行者；也可以直接进某个执行者的对话。

调度器那一侧用自然语言就行，不需要提工具名，例如：

```
让 mcode-web 看一下这个文件有没有问题
分别问一下 backend 和 data：1 加 1 等于几，然后比较耗时
开个新会话，然后问 backend 这个项目用了什么框架
```

调度器会自己决定调哪个工具、哪个执行者。

---

## 工具

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `agent_run` | 发 prompt 给某个 agent。默认不等结果：立刻返回，答案之后以「【执行者回报】」消息回到调度器；`wait: true` 才在本轮里等 | `agent`、`prompt`、`wait`、`model`、`timeout`、`retry_of` |
| `agent_sessions` | 列会话（标签 / 标题 / cwd / 时间），`*` 标活跃 | `agent`、`limit` |
| `agent_session_new` | 给一个执行者开新会话并命名（一个会话对应一个模块 block），随即成为活跃会话 | `agent`、`label` |
| `agent_session_use` | 切到已有会话，按名字（模块名）或会话 id | `agent`、`session` |
| `agent_session_rename` | 给会话改名（默认当前活跃的那个） | `agent`、`label`、`session` |
| `agent_models` | 列模型 / 推理强度 / 权限选项 | `agent`、`sessionId` |
| `agent_set_model` | 为会话设模型 | `value`、`configId` |
| `agent_status` | 存活、健康、会话、模型、spawns、pid、cwd | `agent` |
| `agent_instances` | 列出本项目的执行者及可创建的类型 | — |
| `agent_instance_create` | 给本项目加一个执行者，绑定项目内的一个目录 | `id`、`type`、`cwd`（相对项目根目录） |
| `propose_handoff` | 提议给某个执行者（或调度器自己）换新会话；只是提议，生成文档和确认由人来做 | `agent`、`reason`、`evidence` |

这些工具只存在于项目的调度器里；`agent` 参数是执行者在本项目里的名字（daemon 端把它限定在本项目内）。

几个约定：

- **会话是延续的**：不加 `reset` 就接着上次聊。要干净起一轮，说「开个新会话」。
- **模型是会话级的**：每个会话独立，切换后下一轮生效。
- **标签只在本地**：agent 自己没有 rename 接口，所以标签存在 `data/projects/<项目>/session-labels.json`，在 agent 自己的界面里看不到。
- **流式进度**：长任务运行时 TUI 会显示 `mcode: 123 chars · 4.2s`。
- **中断**：Ctrl+C 会触发 `session/cancel`。

### 返回的指标

```
model:       DeepSeek V4.1 Flash
duration:    4589ms   first token: 3668ms
tokens:      in 2441 / out 147 / cache-read 0 / total 2588
tps:         32 tok/s (output)
throughput:  108.7 chars/s, 499 chars in 124 chunks
context:     2588 / 1000000 (0.3%)
cost:        0.000909 USD
log:         data/projects/<项目>/runs/pi-xxx.log
```

`tokens` 只有 pi agent 能给——mcode 和 dsh 的协议不暴露 token 数，会如实显示
`not exposed by this agent`。

---

## 配置

### 没有项目就不工作

所有执行者和调度器都属于某个项目，daemon 启动时池子里是空的，也不会自己创建任何目录：

- 没有「内置」或「全局」的执行者；没有项目时，`run`、`status`、`dispatcher.*` 这些操作都会被拒绝，并说明需要先建项目。
- 执行者的工作目录就是「项目根目录 + 它的子目录」（创建时若子目录不存在，会在项目根目录内建出来）。
- `agentd.config.json` 里没有每个 CLI 的启动目录一项了（`limits`、`defaultModels`、`roles` 仍在：`roles` 是没写用途的执行者按类型默认的用途）。

### 对话记录

agentd 把它经手的每一轮对话记在 `data/projects/<项目>/transcripts/<执行者>/<sessionId>.jsonl`（user / assistant 两类条目，
带递增 `seq`、`jobId`、`stopReason`），看板读它即可，不必向 agent 要历史。

```
agentd 操作：transcript {agent, sessionId?, afterSeq?, limit?, tail?}
```

不传 `sessionId` 取活跃会话；`afterSeq` 用来增量拉取；agentd 没经手过的会话返回 `recorded:false`。

### 调度器：由 pi（及其 LLM）决定调哪个 agent

调度器是 agentd 持有的一个 `pi --mode rpc` 进程，加载了 agent-router 扩展，由它的 LLM（例如 DeepSeek）
读用户请求并调用 `agent_run` 等工具。注意它和池里的 `pi` agent 不是一回事：后者带 `--no-extensions`，只是执行者。

| 操作 | 作用 |
| --- | --- |
| `dispatcher.state` / `models` / `setModel {value}` / `setThinking {level}` | 状态、可用模型、切换模型（`provider/modelId`） |
| `dispatcher.prompt {message}` / `abort` | 发请求 / 中断；进度以 `dispatcher.event` 推给订阅 `*` 的连接 |
| `dispatcher.new` / `sessions` / `use {sessionFile}` / `messages` | 会话管理与历史（历史由 pi 自己保存） |
| `dispatcher.customModels` / `addModel` / `removeModel` | 增删 pi 的 LLM（写 `models.json`，然后重启调度器） |
| `dispatcher.restart` | 重启调度器进程，会话自动恢复 |

添加 LLM 示例（参数名与 pi 的 `models.json` 一致）：

```json
{ "provider": "my-llm", "baseUrl": "https://example.com/v1", "apiKey": "$MY_LLM_KEY",
  "models": [{ "id": "my-model", "name": "My Model", "reasoning": false }] }
```

- `apiKey` 写环境变量引用（`$NAME`）或字面值；以 `!` 开头会被拒绝（pi 会把它当 shell 命令执行）
- 文件在 `PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）下，写入前备份为 `models.json.bak`
- 调度器正在处理请求时拒绝修改，先 `dispatcher.abort`

### 项目：配置单元

项目 = 一个根目录 + 一个调度器（pi，cwd 就是根目录）+ 一组实例（`id`、`type`、相对根目录的 `dir`、`role`）。
实例只属于一个项目、不共享，池里的键是 `<项目>~<实例>`；不同项目可以有同名实例，各自是独立进程。
配置存在 `data/projects/<项目>/project.json`，重启 daemon 后恢复；删项目会把它的整个文件夹（配置、对话、任务、回执…）一起删掉。

- **切项目只是切视图**：其它项目的进程继续跑，不卸载。
- **没有「全局」视图**：看板里一切都挂在项目下；空闲回收对所有执行者生效。
- **懒启动**：创建实例只写配置，第一次用才拉起进程；空闲超过 `limits.idleMinutes`（默认 15）自动回收，下次用到再起。
- **启动重试**：执行者进程启动时退出（如 mcode 偶发起不来），最多重试 3 次（间隔递增）；同一种 CLI 的启动串行化（并发启动 mcode 会互相打架）；最终失败的错误带上进程 stderr 末尾几行，界面上显示「启动失败：…」，下次使用会重新尝试。
- **进程总数上限** `limits.maxProcesses`（默认 12，或 `AGENTD_MAX_PROCESSES`），超了拒绝拉起。
- **隔离**：`dir` 必须落在根目录内（拒绝 `..`、根外绝对路径、指向根外的符号链接/junction）。
  项目调度器的所有工具调用都被限定在本项目内（环境变量 `AGENTD_PROJECT`，daemon 端改写 agent 名并拒绝含 `~` 的名字）。
- **创建实例时可选模型和会话**：`model`（不填则用 `agentd.config.json` 的 `defaultModels.<类型>`，mcode 默认 M3）；`sessionId` 填已有会话即接着用，不填或 `new` 就在首次使用时新建。
  实例会记住最后用的会话，进程被回收或 daemon 重启后回到同一个会话。可选项由 `project.models {type}` 和 `project.sessions {project,type,dir}` 提供（用临时进程探测，已被别的实例占用的会话不会列出）。
- **设置抽屉**：看板主界面只放对话；每个成员（调度器、执行者）右上的「设置」里改用途、模型、会话（切换/新建）。
  对应操作 `project.updateInstance {project,id,role?,model?}`、`use`/`new`（执行者会话）、`dispatcher.use`/`new`/`sessions`（调度器会话，带标题）。
  调度器重启后回到最新的会话。
- **角色**：`role` 是给调度器看的用途说明（`agent_instances` 会列出）。没写则取 `agentd.config.json` 的 `roles.<类型>`。
- **确认**：关闭/删除项目、删除实例时若还有任务在跑，会返回 `still running: …`，带 `force` 重发才会中断它们（看板会弹确认）。
- 调度器模型列表只显示有凭据的模型（`auth.json`、`models.json` 里带 apiKey 的 provider、`<NAME>_API_KEY` 环境变量）。

```
agentd 操作：projects | project.create {id,name?,root,instances?} | project.addInstance {project,id,type,dir,role?}
            project.removeInstance {project,id,force?} | project.stop {project,force?} | project.remove {project,force?}
            agents/instances/dispatcher.* 均可带 {project}；带 {project, short:true} 时名字不带前缀
```

协议版本 3。后端对应 `/api/projects…`，调度器路由加 `?project=<id>`。

### 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PI_CLI` / `PI_NODE_BIN` | 预检清单，没有就在 node 旁边找 | 调度器启动 pi 用的入口 / node |
| `DISPATCHER_SESSION_DIR` | `./data/projects/<项目>/dispatcher-sessions` | 调度器会话文件目录 |
| `AGENTD_PIPE` | `\\.\pipe\pi-agentd` | 命名管道地址 |
| `AGENTD_PORT` | — | 改用 TCP `127.0.0.1:<port>` |
| `AGENTD_IDLE_MIN` | `30` | 空闲多少分钟自动退出 |
| `AGENTD_CONFIG` | `./agentd.config.json` | 配置文件位置 |
| `MCODE_NODE_BIN` | 预检清单里的 node，没有就是运行 daemon 的 node | node 可执行文件 |
| `AGENTD_NODE_MODULES` | node 旁边的 `node_modules` | 没有预检清单时，到哪里找 CLI 的 npm 包 |
| `AGENTD_CLIS_FILE` | `./data/global/clis.json` | 预检清单的位置 |

### 驱动与预检：怎么找到 CLI，怎么应对升级

分两个包，职责不同：

- **驱动**（`packages/drivers`）：每个 CLI 一个文件，写明它要哪些 npm 包（固定到验证过的版本）、怎么启动、规则怎么交、MCP 怎么交、
  有没有 `/compact`、会话能不能直接从磁盘读。daemon 里不再有「如果是 pi 就……」的判断，只问驱动的 `capabilities`。
  `test/drivers-test.mjs` 检查每个驱动都符合约定；`packages/drivers/probes` 里的行为探针（规则、MCP、恢复会话）是升级后重新验证行为的办法，用 `npm run preflight -- probe` 运行。
  **某个 CLI 升级后行为变了，主要改它的驱动**；驱动对外的约定不变，别的部分就不用动。
- **预检**（`packages/preflight`）：在 daemon 之外运行，找出各 CLI 的 npm 包装在哪、什么版本，和驱动里验证过的版本对照，
  结果写成清单 `data/global/clis.json`（daemon 只读这个文件；没有它就在 node 旁边的 `node_modules` 里找）。

```powershell
npm run preflight                          # 检查，只读，什么都不改
npm run preflight -- write                 # 检查，并写下清单（daemon 下次启动 CLI 时就用它，不用重启）
npm run preflight -- probe                 # 深度自检：真的让每个 CLI 带着规则和一个 MCP 工具跑两次（新会话、重启后恢复），约 1 分钟，会调用真实模型
npm run preflight -- install               # 只显示会装什么（缺的包，固定版本），不执行
npm run preflight -- install --yes         # 真的装：只装缺的，装进 data/global/tools（不装全局），然后写清单
npm run preflight -- install --yes --pin   # 连版本不一样的也装验证过的那个（脚手架自己的那份优先于全局的）
npm run preflight -- --type claude,pi      # 只看 / 只装这几个；加 --json 输出机器可读结果，--strict 缺了就退出码 1
npm run preflight -- core                # 规格库（SpecLock Core）：显示会下载什么，不执行；检查报告里也有它的一行
npm run preflight -- core --yes          # 真的下载：把验证过的那个提交（公开仓库，不用登录）取到 data/global/tools/speclock-core，再建好它的 Python 环境；需要本机有 git 和 uv
```

- 安装是**可选**的，而且**从不自己发生**：不加 `--yes` 什么都不做。装的是验证过的固定版本，装进脚手架自己的目录
  `data/global/tools`，不碰你自己装的全局版本；会从 npm 下载，并运行这些包的安装脚本。
- 查找顺序：脚手架自己的目录，然后全局。**验证过的版本优先**：全局的是验证过的版本，就用全局的。
- 版本比验证过的新，只提示（`~`），不阻止：这时该跑探针看行为有没有变。
- 登录和配置没法替你做，只提示（比如没有 `~/.claude/settings.json`、pi 没有凭据）。
- 没装的 CLI，启动时会说「没装哪个包、去哪找」，不会去启动一个不存在的路径。

### 团队规则

调度器和执行者各有一段规则（能做什么、不能做什么、怎么汇报），来源是 `packages/agentd/contexts/project.md`（项目的调度器）和
`contexts/executor.md`（每个执行者）。它们在启动进程或开会话时，通过各个 CLI 自己的「额外系统提示」入口交给 agent，
**不写进你的项目**，项目自己的 `AGENTS.md` / `CLAUDE.md` 也不会被碰，两边同时生效。入口见上面的表。

- 改这两个文件后重启 daemon；已经在跑的进程要等下次启动才会拿到新规则（dsh 是新会话的第一条消息）。
- 项目里不再生成 `AGENTS.md`、`CLAUDE.md` 或技能目录。以前版本生成的文件（第一行有 `speclock:managed` 标记）还在，
  不影响使用，想清理可以自己删。
- **执行者模板**：新建执行者对话框里的「管理模板」可以新建、编辑、删除模板，也可以直接改文件 `contexts/templates/<标识>.md`。
  文件头写名称、用途、目录（`.` 是项目根目录）、建议的 CLI 和模型，正文是这类执行者的系统提示词（markdown，HTML 注释不会交给 agent）。
  新建执行者时选模板就会预填这些；创建出来的执行者记着自己来自哪个模板，规则 = 通用规则 + 模板提示词，
  **每次启动时重新读**，所以改模板后，用它创建的执行者下次启动就用新提示词，不用逐个改。自带七个，名字是中文，每个带一个建议的规格角色（创建时可以改）：业务分析师（交付项目，需求）、产品经理（自己的产品，需求）、前端开发工程师、后端开发工程师、数据开发工程师（执行）、测试工程师（测试）、规格审查员（扫描）。
- 交接不再用技能文件：执行者直接把交接文档作为回复交出来，agentd 保存副本在 `data/projects/<项目>/handoffs/`，项目里不留文件。
  交接用的两条提示词也是 md：`contexts/handoff-write.md`（生成文档时发）、`contexts/handoff-start.md`（开新会话时发，`{{doc}}` 换成文档）。
  它们**不是**启动时的规则，只在交接那一步发出；改了下次交接就生效，不用重启。

### 给执行者接 MCP 服务器（比如 SpecLock Core）

每个执行者可以带一组 MCP 服务器（`mcpServers`，ACP 的原生格式）。agentd 只负责把它们交给 CLI，不知道它们是干什么的；
同样**不写进你的项目**，也不碰各 CLI 自己的配置文件。

```json
{ "id": "backend", "type": "claude", "dir": "./server",
  "mcpServers": [{ "name": "speclock", "command": "speclock",
                   "args": ["mcp", "--key-file", "executor-agent--backend.key"],
                   "env": [{ "name": "SPECLOCK_HOME", "value": "D:/work/shop/.speclock" }] }] }
```

- 创建时在 `project.addInstance` 里给，之后用 `project.updateInstance` 改（传空列表就是清掉）；调度器不能用这两个操作。
- 状态里只显示服务器的名字和种类（`mcp`），不显示 `env` 和 `headers`——里面可能有密钥。
- **每次开会话或恢复会话时都会重新交一遍**：实测 CLI 只会启动「这次请求里」带的服务器，`session/resume` 不带就没有。
  所以改了列表，下次启动进程或下次恢复会话时生效，正在跑的会话不变。
- 六种 CLI 都实测过（`npm run preflight -- probe`，模型真的调用了工具；`test/live/mcp-live-test.mjs` 经 agentd 再测一遍）：
  mcode、dsh、opencode、claude、codex 走 `session/new` / `session/resume` 的 `mcpServers`。mcode 是用到时才启动服务器，别的是会话一建好就启动。
- pi 没有这个参数，走另一条路：agentd 把服务器放进环境变量 `AGENTD_MCP_SERVERS`，适配器改用 `-e builtin:mcp -e pi-adapter/mcp-bridge.ts` 启动内层 pi
  （去掉 `--no-mcp`，仍然 `--no-extensions`，所以不会加载别的扩展；没配服务器时仍是 `--no-mcp`）。
  注意：pi 内置的 MCP 客户端**还会读它自己的** `~/.pi/agent/mcp.json` 和项目里的 `.pi/mcp.json`，所以这两个文件里的服务器也会出现在 pi 执行者里
  （这台机器上前者不存在）。`--no-mcp` 当初就是为防止内层 pi 连回调度器，这两个文件里不要放指向 agentd 的服务器。
  工具设为 `direct`，和别的 CLI 一样直接出现在模型的工具列表里。改列表后 pi 要下次启动进程才生效。

### 供应商：给 CLI 换一个地址和 Key

在看板左下角点齿轮打开设置，选「供应商」：填一次 Key、地址和模型 id，点「测试」，agentd 会先对地址发一个最小请求，
再**逐个启动能用它的 CLI**，让它通过这个供应商回答一个词，列出哪些真的能用。通过后，到执行者的设置里选这个供应商。

- **按设备保存**：存在 `data/global/providers.json`（不进 git，只有本机用户可读），所有项目共用。Key 只出不进：列表和接口只返回末四位。
- **每个供应商自己选「可用的 CLI」**：保存时勾选，默认勾上不碰各 CLI 全局配置的五个，**mcode 默认不勾**。只有勾上的 CLI 才会被测试、才能在执行者里选这个供应商；
  每个 CLI 一行有「只测它」按钮，「测试全部已启用的」只测勾上的。已有执行者在用的 CLI 不能取消勾选。
- **两种地址**：Claude Code 和 MiniMax Code 说 Anthropic 协议，其余说 OpenAI 兼容协议（Codex 还要求地址支持 `/responses`）。
  两个地址都填就都能测；缺哪个，用那个协议的 CLI 就显示「需要 … 地址」。
- **怎么交给 CLI**（每个 CLI 一份，写在 `packages/drivers/<cli>.mjs` 的 `provider` 里，都实测过，并用错误的 Key 对照过）：

  | CLI | 做法 |
  |---|---|
  | claude | 进程环境变量 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`，各模型别名都指向所选模型 |
  | codex | 环境变量 `MODEL_PROVIDER` + `CODEX_CONFIG`（JSON）；Key 放在它指定的环境变量里 |
  | opencode | `OPENCODE_CONFIG_CONTENT` 里加一个 provider（OpenAI 兼容），和规则合并 |
  | dsh | `--patch` 一个 yaml（llm-pi-ai 的 providers），Key 按环境变量名取；启动后选这个模型 |
  | pi | 私有的 `PI_CODING_AGENT_DIR`（`models.json` 用 `$变量` 引用 Key），所以它看不到 pi 自己的登录 |
  | mcode | **不行用环境变量**：它的供应商存在自己的配置里。测试时临时加一个 `speclock-…` 的供应商、测完删除，不留痕迹；**执行者暂时不能用**，选不了 |

- 以上都只作用于这个执行者的进程，不改你机器上各 CLI 自己的配置（mcode 的测试除外，见上）。改了执行者的供应商会让它的进程重启，下次使用时生效。
- 失败时界面显示原因：地址被拒（带状态码和服务端原话）、CLI 没装、CLI 启动失败、没有这个模型、答不出来。Key 不会出现在任何一条里。
- 调度器不能用任何 `provider.*` 操作。接口：`/api/providers`（GET 列表、POST 保存、DELETE `/:id`、POST `/:id/test`）。
- 想在自己的账号上验证：`PROVIDER_TEST_KEY=… PROVIDER_TEST_MODEL=… PROVIDER_TEST_OPENAI=… PROVIDER_TEST_ANTHROPIC=… npm run test:provider-live -- claude`（用 `npm run test:isolated` 的私有 daemon 跑更稳）。

---

## 运维

```powershell
# 在仓库根目录或 packages/agentd 下都可以用：
npm run restart-daemon                                # 让守护进程用上新代码：正常退出再启动；有任务在跑就拒绝、什么都不改
npm run restart-daemon -- --stop-only                 # 只正常退出，不重新拉起
npm run restart-daemon -- --help                      # 查看帮助，不会执行任何操作
# 退出码：0 成功；1 有任务在跑或排队，未改动任何东西；2 未能在 30 秒内退出或参数错误
npm test              # 在私有守护进程上跑整套回归：独立的数据目录、临时目录和管道，跑完整个删除，不碰你正在用的那个
node packages/agentd/scripts/run-isolated.mjs test:projects test:events   # 同样在私有守护进程上，只跑指定的几组
npm run test:events   # 事件 id / 重放 / 重启检测
npm run test:switch   # 会话切换 + 标签
npm run test:models   # 模型隔离 + 跨重启持久化
npm run test:health   # 健康信号 + 回执 + 崩溃恢复
npm run test:stream   # 流式 + 指标
npm run test:daemon   # 单 daemon / 单套 agent
npm run test:cwd      # 每个 agent 的启动目录
npm run test:models-json  # models.json 编辑器（纯单元，不调 LLM）
npm run test:instances    # 多实例
npm run test:transcript   # 对话记录
npm run test:dispatcher   # 调度器（加 -- --prompt 会真的调一次 LLM）
npm run test:executors-live    # opencode / claude / codex 作为执行者的端到端（真实模型，不在 npm test 里）
npm run test:dispatcher-live   # 调度器自动压缩和交接（真实 pi 和模型，不在 npm test 里）
npm run test:stop-guard        # 测试用的停 daemon 脚本不会杀掉正在跑任务的 daemon（不在 npm test 里）

npm run daemon        # 前台启动（调试用）
npm run daemon:log    # 跟踪日志
npm run daemon:stop   # 停掉
```

### 状态文件

都在 `data/`，按「属于谁」分两块（`AGENTD_DATA_DIR` 可整体换位置）：

| 位置 | 内容 | 能不能删 |
| --- | --- | --- |
| `global/` | 属于这台机器：`providers.json`（供应商和 Key）、`clis.json`（预检清单）、`tools/`（预检装进来的 CLI）、`agentd.log`（daemon 日志） | 删了要重新配供应商、重新预检 |
| `projects/<项目id>/` | 属于这个项目的一切：`project.json`（配置）、`transcripts/`（按执行者、会话分文件的对话记录）、`dispatcher-sessions/`、`pi-sessions/`、`session-labels.json`（标签 + 模型选择）、`tasks.json`、`receipts.jsonl`（每次运行的回执）、`journal.jsonl`、`results/`（长回复全文）、`handoffs/`、`rules/`（交给各 CLI 的规则文件，每次启动重写）、`runs/<jobId>.log`（单次运行的流式正文，超过 14 天自动清） | 要备份；**删项目就是删这个文件夹**，不会留下别的 |

`agentd.endpoint.json`（daemon 实际监听地址，跨 shell 共享的关键）留在 `data/` 最上层。

### 排查

| 现象 | 先看 |
| --- | --- |
| 调用没反应 | `data/global/agentd.log` |
| 回答很慢 | 用 `agent_status` 看是 agent 慢还是外层模型慢 |
| agent 反复重启 | `spawns` 是否持续增长；看 `agent.exit` 事件 |
| 上下文快满 | 回执里的 `attention` 有 `context_pressure` |
| 切不过去会话 | 会话 id 和 cwd 都要对；跨进程恢复必须带 cwd |
| 修改配置不生效 | 重启 daemon |

---

## 范围

**做**：进程寿命、会话路由、模型选择、健康观测、运行回执。

**不做**：执行、上下文管理、工具调用、修改 agent 的输入或工作区。

## 已知限制

- 同一个 agent 内串行：ACP 一个连接一次只能跑一个 prompt；不同 agent 可并行
- 流式粒度取决于 agent：dsh 只发 1 个 chunk（整段返回）
- mcode / dsh 不暴露 token 数
- 会话标签只在本地，agent 自己的界面看不到
- 对话记录只含经 agentd 的轮次；在 agentd 之外直接用 CLI 产生的会话没有记录
- 新增 LLM 要重启调度器 pi 才生效（agentd 自动做，但会打断空闲前的进程内状态）
- 协议版本为 2；旧版 daemon 需先 `npm run daemon:stop`
- pi agent 的 cwd 在进程启动时固定，改它要重启 daemon
- 切过的会话会一直留在进程内存里（没有调用 `session/close`）
