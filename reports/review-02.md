# 代码审核记录 #02（AI 自审发现）

- **用什么手段查**：Harness 加载根目录规则文件 `AGENTS.md` 第 3 节「1. 接口入口」与「6. 安全」核查清单，对 `packages/agentd/daemon/ops/system.mjs`、`packages/agentd/daemon/guard.mjs` 与 `packages/agentd/daemon/receipts.mjs` 执行逐段 AI 自审
- **查了什么**：
  1. 多项目并存时，`system.mjs` 的 `receipts` 查询接口是否按调用方传入的 `project` 实施数据层单侧过滤。
  2. `guard.mjs` 拦截项目调度器（`caller: "dispatcher"`）越权操作或目录逃逸请求时，是否留下可事后追溯的拒绝审计记录，以及回执是否记录操作来源 `caller`。
- **判据**：
  1. 对照 `AGENTS.md` 第 3 节安全与入口判据：带 `project` 查询回执必须只返回该项目目录下的记录（跨项目 0 泄漏）。
  2. 对照第 8、9 课 SEC-07 审计要求：回执须包含调用来源、执行者、状态、耗时与用量；被拒绝的越权请求必须单行 JSON 落盘可查，且审计查询接口本身对受限角色 `dispatcher` 不可见。
- **结果**：
  - **自审报出两处缺陷**：
    1. `system.mjs` 原写为 `receipts: ({ limit } = {}) => ({ receipts: readReceipts(Math.min(Number(limit) || 50, 500)) })`，虽然底层 `readReceipts(limit, project)` 已实现按项目读取，但入口漏解构透传 `project`，导致传入 `project: "projA"` 仍返回全量项目回执。
    2. `receipts.mjs` 缺少 `caller` 字段，且 `guard.mjs` 拒绝越权调用时仅抛异常未写审计日志。
  - **修复与固化**：
    1. 在 `system.mjs` 补齐 `project` 单侧透传并新增 `audits` 查询操作，同步将 `audits` 加入 `guard.mjs` 的 `DISPATCHER_DENIED` 黑名单；
    2. 在 `ops/run.mjs` 与 `receipts.mjs` 补齐 `caller` 字段，新增 `appendAudit` 将所有 `guard.mjs` 拦截事件写入 `data/global/audit.jsonl`；
    3. 编写 `packages/agentd/test/unit/security-audit-test.mjs` 覆盖上述全部正反例，挂入 `make check-security` / `npm run check:security` 常驻执行，复测全绿。
