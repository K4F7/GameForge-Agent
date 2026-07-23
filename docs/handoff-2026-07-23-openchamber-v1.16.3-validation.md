# OpenChamber v1.16.3 与 Observer 联合验收交接

日期：2026-07-23
状态：待新 Agent 继续执行

## 目标

继续完成 GameForge 外置测试框架的真实验收，优先确认 OpenChamber v1.16.3 的生产构建是否消除 v1.16.2 的动态资源与 PWA manifest 回归；随后在真实 CodeArts Task 中联合验证 OpenCode Observer、ConPTY/VT、MCP Audit、Relay Authority 和浏览器 Evidence 的关联闭环。

本轮不是开发第三套产品 UI，也不得修改 OpenChamber 上游页面来迁就测试。CodeArts 仍是主智能体；MCP 只提供确定性工具。

## 必读文件

开始操作前完整阅读：

- 根目录 `AGENTS.md`；
- `docs/decisions/0003-opencode-first-observer-stack.md`；
- `docs/glossary.md`；
- `docs/handoff-2026-07-23-opencode-observer.md`；
- `docs/ui-test-harness-design.md`；
- `packages/ui-test-harness/README.md`；
- `experiments/2026-07-23-opencode-observer-probe/result.md`；
- `experiments/2026-07-23-ui-test-harness-minimal-closure/result.md`；
- `experiments/2026-07-23-ui-test-harness-mvp/result.md`。

遵循根 `AGENTS.md` 的子代理规则。奠基性文档和即将修改的具体代码由主 Agent 亲自阅读；跨目录检索、外围日志分析和独立核验可交给子代理。若遇到 HTTP 429、rate-limit 或 quota，立即将并发降到 1–2 个子线程，等待已有子线程返回后再派发，不要持续扩大并发。

## 当前基线

### OpenChamber

官方仓库已作为 Git submodule 加入：

- 路径：`vendor/openchamber`；
- 上游：`https://github.com/openchamber/openchamber.git`；
- 固定标签：`v1.16.3`；
- 固定提交：`8040d43b251a015eb06d96135a442abd4d2f2e27`；
- `.gitmodules` 与 gitlink 当前已暂存。

不要复用或提交 `openchamber_probe2/`。它是旧的 v1.16.2 本地探针目录，不是后续固定基线。新环境初始化应执行：

```powershell
git submodule update --init --recursive
git -C vendor/openchamber describe --tags --exact-match
git -C vendor/openchamber status --short
```

预期标签为 `v1.16.3`，submodule 工作树为空。

### 已验证能力

- CodeArts Agent 26.6.2 的真实 ConPTY、TUI readiness、文本提交、VT/Evidence、Relay Authority、MCP Audit 和超时门禁已经闭合。
- 修复 MCP 子进程继承残留外部 Provider 凭据后，真实无人值守最小任务已完成：Task/Run completed、RunEvent 到 `run.completed`、MCP Audit 有 8 次调用。
- `@opencode-ai/sdk@1.18.3` Observer 已实现顺序、`after` 游标、重连重复 ID 去重和损坏序列拒绝测试。
- OpenCode 1.18.4 与 CodeArts 26.6.2 均真实暴露 `/global/event` 和 `/event` 持续 SSE。
- UI Test Harness 局部 check/test/build 曾通过；Playwright、xterm.js 与 ConPTY 的适配器已经存在。

### 尚未闭合

1. v1.16.3 尚未在本仓库完成依赖安装、生产构建、生产服务和 Playwright 主链验收。
2. v1.16.2 的最终生产 GUI 门禁失败，证据为缺失动态 chunk、manifest 请求、4 个 console error 和 2 个 failed request；不能假定 v1.16.3 已修复。
3. CodeArts 只验证了 SSE 接口存活，尚未用真实业务事件证明 payload schema、SSE `id:`、事件类型和重连行为与 OpenCode 一致。
4. Observer 原生事件尚未与同一次真实任务的 `sessionId`、`taskId`、`runId`、VT、MCP Audit、Relay Authority 和浏览器截图形成完整可复核链。
5. 当前工作树有大量未提交改动；局部测试结果不能替代当前状态下的整体回归。

## 执行顺序

### 第一阶段：只验证 OpenChamber v1.16.3

1. 检查 submodule 标签、提交和干净状态。
2. 阅读 `vendor/openchamber/AGENTS.md`、根 `package.json`、`packages/web/package.json` 和官方构建脚本后，再执行依赖安装及生产构建。
3. 使用上游规定的生产入口启动固定 loopback 端口；不得用 Vite HMR 结果代替生产验收。
4. 使用现有 Playwright OpenChamber driver 执行 headless smoke，保存：
   - `loaded`；
   - `before-interaction`；
   - `after-interaction`；
   - `success` 或 `failed`。
5. 收集 console error、page error 和 failed request；逐项记录 URL、状态码、资源名和触发阶段。
6. 至少保持页面运行到足以覆盖旧问题出现的时间窗口，不能只看首次加载成功。

第一阶段通过条件：

- 页面生产构建和生产服务正常；
- 五类关键截图按实际路径保存；
- 最终阶段无 console error、page error 或 failed request；
- `/manifest.webmanifest` 或其 blob fallback 行为符合上游实现；
- 不再出现 `useAppFontEffects` 等动态 chunk 404；
- Evidence 中记录 OpenChamber 版本、提交、命令、端口、耗时和结果。

若 v1.16.3 仍失败，先判断是上游发布物、源码构建、缓存/Service Worker、启动入口还是测试驱动问题。不要直接修改 submodule 源码；保存最小复现与证据，并在主仓库薄适配层内修复仅属于 GameForge 的问题。上游缺陷应单独记录。

### 第二阶段：当前工作树整体回归

在不覆盖用户改动的前提下运行：

```powershell
bun run --filter @gameforge/ui-test-harness check
bun run --filter @gameforge/ui-test-harness test
bun run --filter @gameforge/ui-test-harness build
bun run --filter @gameforge/integrations check
bun run --filter @gameforge/integrations test
bun run --filter @gameforge/integrations build
bun run check
bun run test
bun run build
bun run codearts -- --dry-run
bun run opencode -- --dry-run
```

必须记录实际命令、退出码、测试数量和失败摘要。未经实际运行不得写“通过”。若整体命令失败，先区分当前任务引入的问题与工作树已有问题，不得通过回退其他人的改动来制造通过。

### 第三阶段：真实 Task 与 Observer 联合闭环

1. 使用独立数据目录启动真实 CodeArts；不得与独立 OpenCode 共用数据库或认证状态目录。
2. 在 Observer 已连接的情况下创建并执行一个确定性、无外部媒体账号、无部署发布的最小 Task。
3. 让 CodeArts 完成 Task 认领、MCP Audit 绑定、确定性 MCP 调用、RunEvent 发布和 Run 完成。
4. 同时驱动 OpenChamber 原版 GUI 并执行关键截图。
5. 保存原始 SSE payload，不重写为 GameForge 事实；GameForge 独有状态继续写明确命名的 sidecar Evidence。
6. 主动进行一次受控断线重连，核验 `Last-Event-ID`/`after`、重复事件去重、顺序和缺口处理。

第三阶段通过条件：

- Task 与 Run 均由 Relay Authority 判定为 completed；
- MCP Audit 存在与任务对应的成功工具调用；
- 原始 CodeArts 业务事件包含可审计的 `type/properties`，可用时保留 SSE `id:`；
- 断线重连没有静默丢事件或重复写入；
- VT、原始事件、MCP Audit、Authority、浏览器动作及截图可通过同一组 `sessionId`/`taskId`/`runId` 复核；
- 浏览器最终诊断为零，Authority completed 不得掩盖 GUI 失败；
- 实验结果明确区分事实、推断和未证明项。

## 安全与运行边界

- 不提交 API key、Token、OAuth 数据、认证数据库、本机用户路径或未脱敏会话正文。
- 外部百炼、Seedream、Freesound、火山语音和 MiniMax 当前不配置、不调用；使用程序化或静音回退。
- 没有明确 429、rate-limit 或 quota 证据时，不启用模型 fallback。
- 遇到 429 后只降低并发和等待，不将错误误归因为 MCP、OpenChamber 或 Observer。
- 不执行部署、上传、提审、发布或抖音小游戏平台 preview。
- 不录制视频；只保存关键节点截图。
- 不直接修改 submodule 上游源码来让测试通过。
- 不恢复已删除的 `apps/tui`、`apps/workbench` 或 `apps/desktop`。

## 实验记录要求

新增一个日期明确的实验目录，至少包含 `result.md`，记录：

- 输入任务与验收目标；
- CodeArts、OpenCode CLI、SDK 和 OpenChamber 的准确版本与提交；
- 完整验证命令、耗时、退出码与测试数量；
- Task/Run/session ID 的脱敏关联；
- MCP 工具调用摘要；
- SSE 接口、事件类型、ID、游标与重连事实；
- 截图和浏览器诊断位置；
- 人工干预；
- 429/fallback 是否发生；
- 最终通过/失败结论和剩余风险。

原始本地 Evidence 应写入已忽略的 `.gameforge-validation/`；仓库只提交脱敏结果和必要的可复现说明。

## 完成时必须汇报

1. OpenChamber v1.16.3 是否彻底消除旧动态资源与 manifest 回归。
2. 当前完整 `check`、`test`、`build` 的真实结果。
3. CodeArts 业务事件 schema、SSE `id:` 和重连行为已证明到什么程度。
4. 每项 Evidence 是否能通过 `sessionId`、`taskId`、`runId` 关联。
5. 修改文件、验证命令、结果、人工干预和剩余风险。
