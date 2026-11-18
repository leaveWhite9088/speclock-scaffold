# 高风险三查 · 事务与崩溃一致性（risk-transaction）

- **用什么手段查**：故障注入与崩溃重启对账自动化用例 `packages/agentd/test/live/interrupted-test.mjs` 及模型配置原子写盘测试 `packages/agentd/test/unit/pi-models-test.mjs`
- **查了什么**：
  1. **在途任务预写日志（Write-Ahead Journal）与崩溃对账**：任务派发时先在 `data/projects/<id>/journal.jsonl` 写入 `start` 记录，结束时写入 `end` 与 `receipts.jsonl`。注入守护进程中途强杀崩溃（包括磁盘上残留写了一半的截断 JSON 行），验证重启后能否精确识别未完成任务且不重复记账。
  2. **配置文件多步落盘原子性**：修改 `models.json` 时是否采用「先写 `.tmp` 临时文件 + 保留 `.bak` 备份 + 原子 `renameSync` 替换」，防止进程中断留下半截损坏的 JSON 配置。
  3. **有在途任务时的停机保护**：执行者仍在运行或排队时调用 `daemon.shutdown` 或 `restart-daemon`，验证是否拒绝强停以防撕裂在途状态。
- **判据**：
  1. 守护进程崩溃重启后：已完成任务不重复记录；半截损坏的日志行被安全忽略；未完成任务**恰好生成 1 条** `status: "interrupted"` 回执并向执行者会话写入 1 次中断提示，二次重启**绝不重复生成第 2 条记录**（幂等对账）。
  2. `models.json` 写入前自动生成 `.bak` 备份并通过临时文件原子替换，无半截脏文件。
  3. 存在活跃或排队任务时，`daemon.shutdown` 明确拒绝停机。
- **结果**：
  - 故障注入与二次重启对账全部通过：截断行安全跳过、丢失任务恰好生成 1 条 `interrupted` 回执、二次重启计数仍为 `1`——**绿**。

---

## 复测命令（任意机器可原样执行）

```powershell
npm --prefix packages/agentd run test:interrupted
npm --prefix packages/agentd run test:models-json
```

**期望输出关键行**：
```text
  ✓ only tasks without an end are reported  (j1,j3)
  ✓ a half-written line is ignored
  ✓ the daemon records the lost task as an interrupted receipt  ([["lost-1","interrupted"]])
  ✓ the finished task is not recorded again
  ✓ a second restart does not record it again  (1)
  ✓ the conversation gets the message once, not on every restart
=> ✓ INTERRUPTED TASKS OK
```
