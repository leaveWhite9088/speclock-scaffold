# 安全整改对照与注入反例记录（第 9 课：从红到绿）

本文件记录针对 `reports/security-precheck.md` 中全部红项与盲区的修复动作、同一三段式复测结果，以及常驻回归的三条注入反例。所有断言均已固化至 `packages/agentd/test/unit/security-audit-test.mjs` 并接入 `make check-security`（`npm run check:security`）。

---

## 一、红项修复前后对照表（SEC-01 ～ SEC-07）

| 编号 | 缺口类别 | 修复位置与动作 | 修复前实际 | 修复后复测实际（同一三段式重放） | 复测判定 |
| --- | --- | --- | --- | --- | --- |
| **SEC-01** | 授权 | 网关 `packages/backend/src/server.mjs` `guard(req)` 校验本地 `Host` | 5 个受保护接口返回 `403` | 5 个受保护接口（含新增 `/api/receipts`、`/api/audits`）对非本地 `Host` 全部返回 `403` | **绿** |
| **SEC-02** | 授权 | `packages/agentd/daemon/ops/system.mjs` 的 `receipts` 补齐 `project` 参数单侧透传过滤；`guard.mjs` 保持跨项目实例硬拦截 | 跨项目派发已拦截，但 `receipts({ project: "projA" })` 漏传过滤参数，返回了 `projA`+`projB` 共 2 条记录 | `receipts({ project: "projA" })` 精确返回 1 条（仅 `projA~coder`，0 条跨项目泄漏）；跨项目派发稳定拦截 | **绿** |
| **SEC-03** | 授权 | `packages/agentd/daemon/guard.mjs` `DISPATCHER_DENIED` 并将新增的 `audits` 一并纳入禁止名单 | 4 个管理接口被拒 | 包含 `audits` 在内的 5 类管理与审计接口对 `caller: "dispatcher"` 100% 拦截，配置零改动 | **绿** |
| **SEC-04** | 授权 | `guard.mjs` `checkCaller` 禁止 `dispatcher` 在 `run` 中携带 `reset`、`sessionId` 或 `cwd` | 越权参数被拦截 | 重放 `run` 携带 `reset: true` 稳定拦截并留存拒绝日志 | **绿** |
| **SEC-05** | 资产 | `scripts/check-security.mjs` 扫描全量 Git 历史、源码、构建产物与日志 | 0 命中 | 复跑 `npm run check:security` 全量扫描，0 命中 | **绿** |
| **SEC-06** | 资产 | 核实 `picomatch` 官方最新为 `4.0.7`（`fixAvailable: false`），建立结构化可检查豁免表 `scripts/security-allowlist.json` 并接入安全门禁 | 存在 6 条未书面登记的前端构建期高危通报，门禁退出码 `1` | 门禁自动校验包名、GHSA 编号、构建期作用域与有效期，未登记高危 0 条，门禁退出码 `0` | **绿** |
| **SEC-07** | 日志 | `ops/run.mjs` 与 `receipts.mjs` 补齐 `caller` 字段；新增 `appendAudit` 将 `guard.mjs` 拒绝请求写入 `data/global/audit.jsonl` | 回执缺 `caller` 字段；越权被拒请求无日志留痕 | 回执完整包含 `caller`、`agent`、`status`、`durationMs`、`tokens`；重放越权请求后 `readAudits()` 查出对应 `status: "denied"` 记录 | **绿** |

---

## 二、注入反例三件套（常驻回归记录）

三条反例均位于 `packages/agentd/test/unit/security-audit-test.mjs`，随每次 `make check-security` / `make check` 自动运行：

### 1. 命令前缀注入反例（对应查询/命令注入防护）
- **前置条件**：隔离临时目录初始化 `pi` 模型配置存储。
- **操作**：调用 `addPiProvider` 提交 `apiKey: "!echo key"`（底层 `pi` 会将以 `!` 开头的键值作为子壳命令执行）。
- **期望可观测结果**：拒绝写入并抛出明确错误，`models.json` 不生成。
- **当前实际**：抛出 `apiKey must not start with "!": pi would run it as a shell command`，拦截成功——**绿**。

### 2. 目录逃逸注入反例（路径穿越防护）
- **前置条件**：项目 `projA` 已创建在受控临时目录。
- **操作**：调用 `scopeArgs('new', { caller: 'user', project: 'projA', agent: 'coder', cwd: '../outside-dir' })`。
- **期望可观测结果**：`projects.resolveInside` 判定目录越出项目根并拒绝，同时向 `audit.jsonl` 写入一条 `denied` 记录。
- **当前实际**：抛出越界错误且 `audit.jsonl` 留存拒绝记录——**绿**。

### 3. XSS 与跨站写请求（CSRF）反例
- **前置条件**：网关服务启动在本地随机端口；扫描 `packages/web/src` 全部前端源码。
- **操作**：① 扫描前端全部 `.ts/.tsx` 是否存在 `dangerouslySetInnerHTML` 或 `.innerHTML =` 未转义注入槽，并检查网关响应 `Content-Type`；② 携带跨站头 `Origin: https://external.example.test` 向 `POST /api/projects` 发起伪造写请求。
- **期望可观测结果**：① 前端原生 HTML 注入槽为 `0` 处（全部经 React JSX 转义），网关强制返回 `application/json; charset=utf-8` 防止浏览器按 HTML 嗅探执行；② 跨站 `POST` 返回 `403`。
- **当前实际**：前端源码 `0` 处危险注入槽，网关返回 `403` 且响应头严格为 `application/json; charset=utf-8`——**绿**。

---

## 三、一键复测命令

```powershell
npm run check:security
# Linux / macOS / CI 等价命令：make check-security
```
