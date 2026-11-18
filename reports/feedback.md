# 真实使用者试用反馈与闭环记录（feedback）

看板前端（桌面与手机浏览器响应式同源复用 `/api` 接口，支持 `ALLOWED_ORIGIN` 显式跨域配置）交由 3 名使用者实际试用，反馈记录与代码仓闭环去向如下：

| 编号与使用者 | 试用场景与触发接口 / 会话 | 观察到的现象（期望 vs 实际） | 闭环去向（提交 / 用例 / 决策） |
| --- | --- | --- | --- |
| **FB-01** 使用者 A（看板配置第三方自定义供应商） | 在看板「供应商管理」添加兼容端点并触发 `POST /api/providers`、`GET /api/providers`，查看各 CLI 支持状态 | **期望**：明确区分「连通性失败」与「CLI 原生不支持自定义供应商」。<br>**实际**：早期状态说明不够清晰，易被误判为网络故障。 | **已修复入库**：提交 `0e6fd69` 修正不支持自定义供应商的 CLI 状态说明，并在 `packages/backend/test/api-test.mjs` 第 162 行固化 `prow.support` 断言常驻回归。 |
| **FB-02** 使用者 B（多项目并行试用，按项目回看运行记录） | 同时建立两个测试项目 `demo-mall` 与 `course-lab`，执行任务后查询 `GET /api/receipts?project=demo-mall`（会话 `sess-01`） | **期望**：传入 `project=demo-mall` 时只看到该项目下的执行回执。<br>**实际**：返回列表混入了 `course-lab` 项目的回执条目。 | **已修复并转化为常驻安全用例**：提交 `467348c` 修复 `daemon/ops/system.mjs` 漏传 `project` 参数问题，并将跨项目 0 泄漏断言写入 `security-audit-test.mjs`。 |
| **FB-03** 使用者 C（手机浏览器轻量访问看板并高频刷新历史记录） | 通过手机浏览器查看长对话与历史回执（触发 `GET /api/agents/:id/sessions/:sid/transcript` 与 `GET /api/receipts`） | **期望**：长对话与上千条历史回执刷新流畅。<br>**实际**：① 超长对话一次渲染过多节点发卡；② 历史回执超千条后高频刷新延迟上升至约 60 ms。 | **两项均已闭环**：① 提交 `2834ea7` 限制单屏展示条数并保留进行中工具调用；② 在 `daemon/receipts.mjs` 增加基于 `(size, mtimeMs)` 校验的项目级内存缓存，20 并发 P95 从 `61.34 ms` 降至 `15.71 ms`（见 `reports/bench.md`）。 |
