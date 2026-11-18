# 代码与用例审核记录 #01（脚本门禁发现）

- **用什么手段查**：执行单元测试门禁脚本 `npm --prefix packages/agentd run test:queue`（纳入 `npm run check` / `make check` 总门禁）
- **查了什么**：`packages/agentd/test/unit/queue-test.mjs` 对 `AcpClient`（`packages/agentd/core/pool/acp/client.mjs`）并发排队与取消清理后的收尾状态断言，以及 Windows 下进程退出句柄清理行为
- **判据**：
  1. 取消排队任务并跑完后续队列后，`a.inflight === 0` 且等待队列为空，脚本以退出码 `0` 正常结束，不得抛出未捕获异常。
  2. Windows 平台关闭测试子进程时不得因提前强制调用 `process.exit()` 触发 libuv `UV_HANDLE_CLOSING` 断言崩溃。
- **结果**：
  - **初跑为红**：`queue-test.mjs` 第 95 行仍引用队列拆分前的旧私有字段 `a.queuedJobs.size` 与 `a.cancelledJobs.size`（重构至 `PromptQueue` 后该属性已迁移为 `a.waitingJobs()`），抛出 `TypeError: Cannot read properties of undefined (reading 'size')`；同时脚本末尾同步调用 `process.exit()` 在 Windows Node v24 下偶发触发异步句柄未关闭异常。
  - **修复转绿**：将第 95 行收尾断言对齐至公开契约 `a.inflight === 0 && a.waitingJobs().length === 0`，并将末尾强制 `process.exit` 改为设置 `process.exitCode` 自然排空事件循环；重跑 `npm --prefix packages/agentd run test:queue` 全部 26 项断言通过，退出码 `0`，用例常驻 `npm run check`。
