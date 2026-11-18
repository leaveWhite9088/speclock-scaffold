# 密钥扫描与依赖审计基线报告（SEC-05 & SEC-06）

- **执行入口**：`npm run check:security`（同 `make check-security`，底层脚本 `scripts/check-security.mjs`）
- **豁免登记表**：`scripts/security-allowlist.json`

---

## 一、SEC-05 密钥明文泄漏扫描结果

扫描范围覆盖四处资产：**全量 Git 提交历史（`git log -p --all`）**、**全部跟踪源码文件**、**前端构建产物（`packages/web/dist/`）**、**本地运行日志（`logs/` 与 `agentd.log`）**。

```text
=== [1/3] SEC-05 明文密钥泄漏扫描 ===
  ✓ 扫描提交历史 …… 通过（0 命中）
  ✓ 扫描工作区与前端产物 …… 通过（0 命中）
  ✓ 扫描运行日志 …… 通过（0 命中）
```

**存储与接口脱敏核验**：
- 供应商密钥仅保存在本机被 Git 忽略的 `packages/agentd/data/global/providers.json` 中，不进代码仓与镜像层。
- `GET /api/providers` 与 `GET /api/dispatcher/llms` 经 `packages/backend/test/api-test.mjs` 断言验证，仅返回掩码尾号（如 `keyHint: "…6789"`），绝不回显明文密钥。

---

## 二、SEC-06 依赖漏洞审计原始数据与书面处置登记

### 1. 官方源 `npm audit` 原始汇总数据

执行 `npm audit --json --registry=https://registry.npmjs.org`，共扫描依赖 269 个（生产依赖 168 个、开发与可选依赖 101 个），漏洞统计如下：

- **Critical（严重）**：`0` 条
- **High（高危）**：`6` 条（全部收敛于同一条底层上游通报 `GHSA-fc5q-39xc-vjpf`）
- **Moderate（中危）**：`0` 条
- **Low（低危）**：`0` 条

### 2. 高危条目逐项书面处置登记（对应 `scripts/security-allowlist.json`）

| 根因包与受影响传导链 | 漏洞编号 / CWE | 为什么暂不升级清零 | 降险与隔离措施 | 复审截止日 |
| --- | --- | --- | --- | --- |
| `picomatch`（`<=4.0.7`）→ 传导至 `fdir`、`tinyglobby`、`vite`、`@vitejs/plugin-react`、`@tailwindcss/vite` 共 6 条计数 | `GHSA-fc5q-39xc-vjpf` / `CWE-1333`（单分支重复 extglob 正则回溯 ReDoS） | 经 `npm view picomatch version` 核实，上游最新发布版即为 `4.0.7`，官方审计标记 `fixAvailable: false`（尚无可用补丁版本；若强行回退 `@vitejs/plugin-react` 至 `1.3.2` 属于跨大版本破坏性降级且仍无法消除 Vite 核心引用） | 1. **零运行时暴露**：`agentd`、`backend`、`drivers`、`preflight` 四个运行时包对 `picomatch` 零引用；该包仅在前端 `vite build` 编译期加载。<br>2. **零外部不可信输入面**：构建期 glob 仅扫描仓库固定源码目录，HTTP 网关不向任何用户暴露 glob 模式匹配接口。<br>3. **自动门禁盯防**：已写入 `scripts/security-allowlist.json`，门禁脚本自动核验有效期与包名，一旦出现任何其他未登记的高危漏洞立即以退出码 `1` 阻断。 | `2027-03-01` |

---

## 三、门禁通过态输出原文

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
```
