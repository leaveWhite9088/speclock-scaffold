# 代码审核记录 #03（AI 自审与压测脚本联合发现）

- **用什么手段查**：Harness 对照根目录规则文件 `AGENTS.md` 第 3 节「3. 数据库与持久化」及「7. 性能」核查清单审查 `packages/agentd/daemon/receipts.mjs`，并配合入库压测脚本 `scripts/bench.mjs`（`VUS=20`）做定量复核
- **查了什么**：
  1. 高频调用的 `readReceipts(limit, project)` 在历史回执文件增长后是否存在全量同步磁盘读取与重复反序列化阻塞。
  2. 引入缓存优化时，缓存失效条件是否覆盖「本进程追加写入」「外部文件变动」与「项目删除清理」三种边界，避免产生陈旧脏读。
- **判据**：
  1. 对照 `AGENTS.md` 第 3 节性能判据：20 并发下回执检索接口不得因全文件重复解析阻塞事件循环，P95 延迟应与内存态接口处于同一量级（`< 25 ms`），错误率 `0%`。
  2. 对照持久化一致性判据：`data-layout-test.mjs` 与 `security-audit-test.mjs` 全绿，新写入回执立即可读，删除项目后无残留缓存。
- **结果**：
  - **发现瓶颈**：原 `readReceipts` 每次查询均同步执行 `readFileSync` 读取完整 `receipts.jsonl` 并对全部历史行做 `JSON.parse`；在 1,200 条历史回执、20 并发压测下吞吐仅为 `464.5 QPS`、P95 达 `61.34 ms`。
  - **修复与验证**：在 `receipts.mjs` 增加按项目隔离的内存缓存 `receiptCache`，读取时校验 `statSync` 的 `(size, mtimeMs)`，并在 `appendReceipt` 写入后立即失效对应项目缓存；同一脚本复测吞吐升至 `2,465.0 QPS`（提升 5.31 倍），P95 降至 `15.71 ms`（下降 74.4%），且 `data-layout-test.mjs` 全部通过（详据 `reports/bench.md`）。
