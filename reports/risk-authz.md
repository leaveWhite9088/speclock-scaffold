# 高风险三查 · 权限（risk-authz）

- **用什么手段查**：自动化安全与隔离回归脚本 `packages/agentd/test/unit/security-audit-test.mjs`（随 `npm run check:security` / `make check-security` 常驻执行）
- **查了什么**：
  1. **跨项目执行者操作隔离**：项目 `projA` 的调度器（`caller: "dispatcher", project: "projA"`）尝试向项目 `projB` 的执行者 `projB~coder` 派发任务，或传入 `cwd: "../outside-dir"` 逃逸项目根目录。
  2. **跨项目运行回执单侧过滤**：`projA` 与 `projB` 各存在运行回执时，携带 `project: "projA"` 查询 `receipts` 是否会混入 `projB` 的回执与提示词摘要。
  3. **管理级配置与审计日志角色边界**：`caller: "dispatcher"` 尝试调用全局管理接口（`provider.save`、`template.save`、`project.updateInstance`、`daemon.shutdown`、`audits`）。
- **判据**：
  1. 跨项目执行者调用与路径逃逸一律在 `daemon/guard.mjs` 入口被拒绝抛出越界错误，且向 `data/global/audit.jsonl` 写入 `status: "denied"` 记录。
  2. `receipts({ project: "projA" })` 采用数据层单侧按项目目录读取（`data/projects/projA/receipts.jsonl`），返回条数严格等于 `projA` 自身记录数，`0` 条跨项目泄漏。
  3. 全部 `DISPATCHER_DENIED` 接口对受限角色 100% 拒绝，全局配置零变更。
- **结果**：
  - AI 自审与安全自查基线阶段发现 `packages/agentd/daemon/ops/system.mjs` 的 `receipts` 未透传 `project` 参数导致跨项目回执混出（红）；
  - 修复 `system.mjs` 单侧透传 `project` 并在 `guard.mjs` 补齐拒绝审计留痕后，复测 `projA` 查询仅返回 `1` 条自有记录、跨项目派发与目录逃逸全部拦截并留存 `denied` 审计日志——**绿**。

---

## 复测命令（任意机器可原样执行）

```powershell
npm --prefix packages/agentd run test:security
# 或通过统一安全门禁复跑：
npm run check:security
```

**期望输出关键行**：
```text
  ✓ SEC-01 non-local Host is refused with 403 across all 5 protected endpoints
  ✓ SEC-02 receipts query with project=projA returns only projA records (0 cross-project leak)
  ✓ SEC-02 cross-project executor access from projA dispatcher is refused
  ✓ SEC-03 & SEC-08 dispatcher is blocked from provider/template/project/shutdown/audits ops
  ✓ SEC-07 rejected unauthorized calls are recorded in audit.jsonl with actor, op and denied status
=> ✓ SECURITY & AUDIT OK
```
