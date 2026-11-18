# 持续集成与自动构建流水线记录（pipeline）

- **流水线配置文件**：`.github/workflows/ci.yml`
- **本地与云端统一入口**：`Makefile`（`make check`、`make check-security`）与 `package.json`（`npm run check`、`npm run check:security`）

---

## 一、本地与 CI 单一标准编排

`.github/workflows/ci.yml` 在每次推送至 `main` 及所有 `pull_request` 时自动触发，执行步骤与本地开发门禁同源：

1. **全量历史检出（`fetch-depth: 0`）**：确保密钥扫描覆盖完整 Git 提交历史。
2. **质量总门禁（`make check`）**：执行安全门禁、`drivers` 契约单测、`preflight` 探测单测与 `agentd` 全部 22 个单元/分层/队列/回执套件；任一断言失败即非零退出阻断流水线。
3. **独立安全门禁（`make check-security`）**：执行密钥扫描、依赖漏洞审计与越权/注入反例套件。
4. **可追溯镜像构建**：传入 `--build-arg GIT_SHA=${{ github.sha }}` 构建 `speclock-scaffold:${{ github.sha }}`，并断言镜像标签 `org.opencontainers.image.revision` 与提交 SHA 一致。
5. **Compose 就绪与版本反查验证**：执行 `docker compose up -d --wait` 拉起三服务，请求 `/api/health` 校验返回 `200` 且 `gitSha` 匹配 `${{ github.sha }}`，同时校验 `/api/metrics?format=prom` 指标输出。

---

## 二、镜像编号反查提交链路

1. **静态镜像标签反查**：
   ```bash
   docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' speclock-scaffold:<tag>
   ```
2. **运行实例探针反查**：
   ```bash
   curl -fsS http://127.0.0.1:8080/api/health
   # 输出 {"agents":[...],"ok":true,"gitSha":"<commit-sha>"}
   ```

---

## 三、持久化结构演进说明（扩 → 迁 → 缩）

为满足审计追溯在 `receipts.jsonl` 中新增 `caller` 字段时，采用向后兼容的**扩展步（Expand）**：写入侧默认填充 `caller: task.caller ?? 'user'`，读取与指标聚合侧兼容历史无该字段的存量记录，无需停机迁移或删减旧字段。
