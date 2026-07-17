# GameForge Agent 路线图

更新日期：2026-07-18

## 第一轮：真实 CodeArts 闭环

目标是让 CodeArts Agent 而不是测试客户端完成一次 Workbench Task。

- [x] 在 Windows 安装 CodeArts Agent 客户端；
- [x] 确认当前安装版本与 CLI/TUI 入口：CodeArts 26.6.2，使用 `%USERPROFILE%\.codeartsdoer\installers\codearts.cmd` 启动；
- [x] 使用 OAuth 登录的 CodeArts TUI 完成授权；非交互 `run`/`mcp` 子命令仍单独要求 CLI AK/SK，凭据未进入仓库；
- [x] 使用 `bun install --frozen-lockfile && bun run build && bun run doctor` 验证本地前置条件；
- [x] 按 `docs/codearts-quickstart.md` 通过隔离配置启动 `gameforge` stdio MCP；
- [x] 从本地 Task Inbox 提交一个 `en-US` Task；
- [x] 由 CodeArts 实际列出、认领并回放该 Task；
- [x] 无百炼账号时由 CodeArts 按 Skill 手工构造同 locale 规格并发布 `spec.ready`；
- [x] CodeArts 生成项目、运行构建与浏览器验收、发布 `preview.ready`/`verification.ready` 并完成 Run；
- [x] 保存脱敏实验记录：客户端版本、耗时、工具调用、人工干预、Task/Run ID、截图与失败边界。

通过标准：Relay 中 Task 为 completed，真实 CodeArts Run 发布规格、预览与验证事件，生成项目可构建且 Chrome 证据通过，记录中不存在密钥或账号隐私。该标准已于 2026-07-18 首次通过；本次没有媒体资产，因此没有 `asset.ready`，Workbench 资产面板应保持空状态而不是伪造结果。

2026-07-18 的安全探测确认 `codearts --version` 为 26.6.2，`run`、`mcp`、`agent`、`models` 和 `serve` 等命令可发现；但 `codearts mcp list/add` 在当前 shell 中因未设置 CLI AK/SK 而拒绝执行，现有后台进程也没有可连接的窗口或本地监听端口。详见 `experiments/2026-07-18-codearts-client-probe/`。

真实执行改用 OAuth TUI，并通过临时 `OPENCODE_CONFIG` 隔离加载本地 MCP，不修改用户全局配置。结果见 `experiments/2026-07-18-codearts-real-e2e/`。

## Provider 账号级验收

`bun run provider:smoke` 默认只检查所选 Provider 的环境变量是否齐全，不读取或输出变量值。只有显式执行 `bun run provider:smoke -- --execute --providers=qwen,seedream,freesound,tts` 才会产生真实网络请求与潜在费用。媒体验收要求同时选择 `qwen`，以真实 GameSpec 创建带随机后缀的临时项目；检查与执行的脱敏证据都写入 `.gameforge-validation/provider-smoke/evidence.json`，生成项目保留在同一忽略目录供人工复核。TTS 最多查询五次，未完成时以失败/pending 记录，不在 MCP 工具内部轮询。

## 第二轮：Bun TUI MVP

先做 TUI，再决定是否封装桌面 GUI。TUI 直接复用 `@gameforge/contracts`、Run Relay HTTP/SSE 和现有状态 reducer，不新增 Agent 循环。

- [x] 扩展与 React、浏览器 `EventSource` 解耦的共享 Run Relay Client；
- [x] 新增 `apps/tui`，由 Bun 安装、检查、测试和启动；
- [x] 支持 `--base-url`、新建/提交 Task、查看 Task/Run、停止 Run；
- [x] 显示阶段进度、最近日志、GameSpec locale、资产与验证摘要；
- [x] 支持从游标回放后连接 SSE，显式报告序列缺口和 Relay 断线；
- [x] 保持 URL 只允许 HTTPS 或 loopback HTTP，禁止凭据、query 和 fragment；
- [x] 增加 Windows/macOS/Linux CI，以及交互 TTY 的退出键、resize 重绘和 raw mode 清理测试。

Windows 本地已使用真实 Relay 验证 `submit → watch(SSE) → stop → 自动退出`，并使用真实 CodeArts completed Run 验证英文规格、预览和 verification 摘要。详见 `experiments/2026-07-18-tui-mvp/`。

## 第二轮后半：桌面 GUI 评估

优先评估 Tauri 2 封装现有 React Workbench；Electron 作为生态成熟但体积更大的备选。渲染栈与桌面表面的决策、进入条件和验证要求已记录在 [ADR-0001](./decisions/0001-rendering-and-desktop-surfaces.md)。

桌面 GUI 不改变协议边界：CodeArts 仍是主智能体，Relay 仍只协调状态，MCP 仍是确定性工具。若 TUI 的共享 controller 尚未稳定，不开始桌面打包。
