# 运行观测指标与三段式告警验证记录（observe-alert）

- **指标暴露接口**：
  - 结构化视图与告警状态：`GET http://127.0.0.1:8787/api/metrics`
  - Prometheus 标准抓取格式：`GET http://127.0.0.1:8787/api/metrics?format=prom`
- **实现代码位置**：`packages/agentd/daemon/ops/system.mjs`（`metrics` 操作）与 `packages/backend/src/server.mjs`
- **自动化验证用例**：`packages/agentd/test/unit/security-audit-test.mjs`（第 6 组断言）

---

## 一、指标命名与三类核心观测视图

观测数据直接聚合自审计回执（`receipts.jsonl`）、安全日志（`audit.jsonl`）与执行者池实时队列，不重复造第二套事实源；**错误率不在上报侧冗余存储，由面板按 `status="failed"` 计数除以总调用计数导出**：

1. **各角色/执行者调用量分线计数**（对应需求、实现、测试等不同规格角色实例）：
   - `agent_invocations_total{agent="<project>~<role>",status="done|failed|cancelled"}`
2. **各角色/执行者错误率视图**：
   - 导出表达式：`sum by (agent) (agent_invocations_total{status="failed"}) / sum by (agent) (agent_invocations_total)`
3. **执行耗时 P95 与实时队列深度并排视图**（对应异步改造运行态监控）：
   - `agent_invocation_p95_ms`（任务端到端耗时 P95 分位数）
   - `agent_queue_depth{agent="<project>~<role>"}`（当前在途与排队深度）
   - `security_audit_denied_recent`（滑动时间窗内越权拦截次数）

---

## 二、三段式告警判定规则

告警以可执行判定写入 `system.mjs`，包含**观察量、持续窗口条件、触发动作**三要素：

- **观察量**：滑动窗口内被拒绝的越权调用数 `security_audit_denied_recent`，或窗口内任务错误率 `recentFailed / recentRuns`
- **持续窗口条件**：最近 `5 分钟`（`windowSec = 300`）内连续出现 `越权拒绝 >= 3 次`，或样本量 `>= 5` 时任务错误率 `> 5%`
- **触发动作**：指标 `system_alert_firing` 置为 `1`，告警状态由 `OK` 切换为 `FIRING`，动作字段输出 `notify-maintainer: inspect /api/audits and /api/receipts` 指引值班人直达审计与回执入口定位问题。

---

## 三、人为故障注入与告警真实触发记录

通过重放 SEC-02 / SEC-03 的越权调用（由 `projA` 调度器连续发起跨项目实例调用与禁用管理接口调用），查询 `metrics` 得到的真实告警触发载荷与 Prometheus 文本如下：

```json
{
  "alert": {
    "rule": "5 分钟窗口内越权拒绝 >= 3 次 或 任务错误率 > 5%（样本 >= 5） -> 标记 FIRING 并写入告警通知记录（附 /api/metrics 与 /api/audits 排查入口）",
    "state": "FIRING",
    "windowSec": 300,
    "recentDenied": 7,
    "recentRuns": 2,
    "recentFailed": 0,
    "action": "notify-maintainer: inspect /api/audits and /api/receipts"
  }
}
```

Prometheus 格式输出片段：
```text
# HELP agent_invocations_total Total executor invocations partitioned by agent and status.
# TYPE agent_invocations_total counter
agent_invocations_total{agent="projA~coder",status="done"} 1
agent_invocations_total{agent="projB~coder",status="done"} 1
# HELP agent_invocation_p95_ms 95th percentile invocation duration in milliseconds.
# TYPE agent_invocation_p95_ms gauge
agent_invocation_p95_ms 420
# HELP security_audit_denied_recent Rejected unauthorized calls within the alert window.
# TYPE security_audit_denied_recent gauge
security_audit_denied_recent 7
# HELP system_alert_firing 1 when the 3-part alert rule is firing, else 0.
# TYPE system_alert_firing gauge
system_alert_firing 1
```
