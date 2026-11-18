# 高风险三查 · 并发（risk-concurrency）

- **用什么手段查**：隔离并发队列与启动互斥自动化用例 `packages/agentd/test/unit/queue-test.mjs`、`packages/agentd/test/unit/prompt-queue-test.mjs`、`packages/agentd/test/unit/start-retry-test.mjs` 及网关唯一性用例 `packages/backend/test/api-test.mjs`
- **查了什么**：
  1. **同实例并发投递串行化与排队取消**：向同一执行者连续并发提交多条任务（`slow-1`、`second`、`cancel-me`、`third`），验证任务是否严格按序单飞执行、排队序号 `ahead` 是否准确，以及取消排队中任务是否立即响应且不污染前后任务。
  2. **重复创建同名实例唯一性约束**：在同一项目下并发或重复创建相同 `id` 的执行者实例（`POST /api/projects/:id/instances`），验证是否由底层配置表唯一键拦截而非生成重复实例。
  3. **进程冷启动并发互斥与失败重试上限**：外部 CLI 冷启动偶发退出时自动重试上限（最多 3 次），以及任务级 `planRun` 最大尝试次数防无限风暴。
- **判据**：
  1. 同一执行者任意时刻仅 1 个任务处于运行态，第 2 个任务的实际启动时间戳不早于第 1 个任务完成时间；取消等待态任务立即返回 `{ cancelled: true, queued: true }` 且该提示词绝不送达底层 CLI，后续排队任务正常完成，结束后 `inflight === 0` 且等待队列为空。
  2. 重复创建同名实例稳定返回 `400`（`already exists`），不产生双份实例进程。
  3. 连续崩溃进程恰好尝试 `3` 次后快速失败，不污染后续新启动请求。
- **结果**：
  - 全部并发交错、排队插队/取消、唯一键冲突与重试上限断言均通过，结束后无残留 `inflight` 任务与僵尸子进程——**绿**（用例已挂入 `npm run check` / `make check` 常驻回归）。

---

## 复测命令（任意机器可原样执行）

```powershell
npm --prefix packages/agentd run test:prompt-queue
npm --prefix packages/agentd run test:queue
npm --prefix packages/agentd run test:start
```

**期望输出关键行**：
```text
  ✓ both finish in order
  ✓ the second really started only after the first finished
  ✓ a waiting run can be cancelled  ({"cancelled":true,...,"queued":true})
  ✓ the cancelled prompt never reached the CLI  (slow-1,second,slow-2,third)
  ✓ and nothing is left in flight
=> ✓ QUEUED PROMPTS OK
=> ✓ START RETRY OK
```
