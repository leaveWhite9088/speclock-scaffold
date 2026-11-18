# 门禁「先红后绿」阻断与放行证据（gate-red-green）

本记录归档安全门禁 `make check-security`（`npm run check:security`）真实拦截未处置风险（退出码 `1`）并在完成修复与结构化登记后放行（退出码 `0`）的全程输出。任意机器均可使用文末命令原样复现。

---

## 一、红灯运行（未登记高危依赖豁免时，门禁阻断合入，退出码 `1`）

**复现命令**：
```powershell
node scripts/check-security.mjs --no-allowlist
```

**实测输出原文**：
```text
=== [1/3] SEC-05 明文密钥泄漏扫描 ===
  ✓ 扫描提交历史 …… 通过（0 命中）
  ✓ 扫描工作区与前端产物 …… 通过（0 命中）
  ✓ 扫描运行日志 …… 通过（0 命中）

=== [2/3] SEC-06 依赖漏洞基线审计 ===
  ✗ 发现未登记处置的高危/严重依赖项 6 条: picomatch(high), fdir(high), tinyglobby(high), vite(high), @vitejs/plugin-react(high), @tailwindcss/vite(high)

=== [3/3] SEC-01..04 / SEC-07..08 与注入反例回归 ===
  ...（12 项安全与审计断言通过）...

=> ✗ CHECK-SECURITY FAILED (退出码 1)
EXIT_RED=1
```

---

## 二、绿灯运行（完成风险评估与 `scripts/security-allowlist.json` 登记后，退出码 `0`）

**复现命令**：
```powershell
npm run check:security
# Linux / macOS / CI 等价命令：make check-security
```

**实测输出原文**：
```text
> speclock-scaffold@1.0.0 check:security
> node scripts/check-security.mjs

=== [1/3] SEC-05 明文密钥泄漏扫描 ===
  ✓ 扫描提交历史 …… 通过（0 命中）
  ✓ 扫描工作区与前端产物 …… 通过（0 命中）
  ✓ 扫描运行日志 …… 通过（0 命中）

=== [2/3] SEC-06 依赖漏洞基线审计 ===
  ✓ 未登记高危/严重漏洞 0 条（已书面登记受控构建期依赖 5 条，复审有效期内）

=== [3/3] SEC-01..04 / SEC-07..08 与注入反例回归 ===

=== security & audit ===

  ✓ SEC-01 non-local Host is refused with 403 across all 5 protected endpoints
  ✓ CSRF cross-site Origin write is refused with 403
  ✓ gateway responses enforce application/json; charset=utf-8
  ✓ SEC-02 receipts query with project=projA returns only projA records (0 cross-project leak)
  ✓ SEC-02 cross-project executor access from projA dispatcher is refused
  ✓ SEC-03 & SEC-08 dispatcher is blocked from provider/template/project/shutdown/audits ops
  ✓ SEC-04 dispatcher bypass via run(reset=true) is refused
  ✓ Injection-1: apiKey starting with "!" (command prefix) is refused
  ✓ Injection-2: cwd escaping project root ("../outside-dir") is refused
  ✓ Injection-3 (XSS): web frontend source contains zero raw HTML injection sinks
  ✓ SEC-07 receipt preserves caller, agent, status, durationMs and token usage
  ✓ SEC-07 rejected unauthorized calls are recorded in audit.jsonl with actor, op and denied status

=> ✓ SECURITY & AUDIT OK

=> ✓ CHECK-SECURITY PASSED (退出码 0)
EXIT_GREEN=0
```
