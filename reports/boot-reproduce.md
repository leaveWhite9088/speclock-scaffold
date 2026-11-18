# 可复现构建与一键容器化启动记录（boot-reproduce）

- **多阶段构建文件**：`Dockerfile`、`.dockerignore`
- **多服务编排文件**：`docker-compose.yml`、`docker/nginx.conf`
- **自述文档入口**：`README.md`（「上手」章节）

---

## 一、多阶段镜像与零密钥隔离设计

1. **构建与运行彻底分离**：
   - `Stage 1 (web-builder)`：基于 `node:22-alpine` 执行 `npm ci` 与 `npm --prefix packages/web run build`，编译生成纯静态前端产物 `packages/web/dist/`；Vite、TypeScript、Tailwind 等构建工具链与前端源码全部留在本阶段。
   - `Stage 2 (runtime)`：仅拷贝零第三方运行时依赖的四个核心包（`drivers`、`preflight`、`agentd`、`backend`）及 `Stage 1` 产出的静态 `dist/` 目录，切换至非特权用户 `node` 运行。
2. **零凭证与干净上下文**：`.dockerignore` 显式排除 `.git`、`.env*`、`packages/agentd/data`、`logs` 与本地 `node_modules`，确保宿主密钥或历史会话绝不进入镜像层；运行配置与外部供应商凭证仅在运行时通过环境变量或数据卷注入。
3. **版本可追溯嵌入**：构建时接收 `--build-arg GIT_SHA=<commit>`，同时写入 OCI 标准标签 `org.opencontainers.image.revision` 与运行环境变量 `APP_GIT_SHA`，由 `GET /api/health` 直接返回 `gitSha` 供线上核验。

---

## 二、Compose 三服务就绪依赖链

`docker-compose.yml` 声明三层服务与严格的健康探针就绪顺序（不依赖启动脚本等待循环）：

1. **`agentd`（核心调度守护进程）**：监听共享套接字卷 `/run/speclock/agentd.sock` 并挂载持久化卷 `speclock-data:/data`；健康探针通过客户端发起 `hello` 握手确认协议就绪。
2. **`gateway`（HTTP + SSE 网关与静态托管）**：声明 `depends_on: agentd: condition: service_healthy`，待守护进程探针变绿后启动；健康探针请求 `http://127.0.0.1:8787/api/health`（若底层守护进程未就绪则网关返回 `502` 拒绝接流）。
3. **`web`（Nginx 非特权轻量入口）**：声明 `depends_on: gateway: condition: service_healthy`，统一在 `127.0.0.1:8080` 暴露看板页面、轻量端访问与 `/api` 流式代理。

---

## 三、干净环境一键启动与验证命令

在任意装有 Docker 的干净目录拉取仓库后，无需口头补充步骤，单条命令即可拉起整套服务并等待全部探针就绪：

```bash
git clone git@github.com:leaveWhite9088/speclock-scaffold.git
cd speclock-scaffold
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --wait
curl -fsS http://127.0.0.1:8080/api/health
```

期望健康探针返回：`{"agents":[],"ok":true,"gitSha":"<当前提交号>"}`。同一验收流程已在 `.github/workflows/ci.yml` 中自动化执行。
