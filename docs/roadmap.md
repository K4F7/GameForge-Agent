# GameForge Agent 路线图

更新日期：2026-07-18

## 当前产品优先级：抖音小游戏 V1

第一版首要发布目标已从泛浏览器游戏收窄为抖音小游戏；微信小游戏是第二导出目标。浏览器 Phaser 项目继续承担快速预览和 Chrome 回归，但不能作为小游戏平台验收。决策与官方约束见 [ADR-0002](./decisions/0002-domestic-mini-game-v1.md)。

- [x] 为生成请求、计划和 Manifest 增加显式 `web` / `douyin-mini-game` target；旧请求默认 `web`，未实现平台 target 会明确失败；
- [x] 完成 Phaser 4 抖音小游戏无 DOM 兼容性 spike；动态导入与初始化触发广泛浏览器依赖，按 ADR 停止 shim 路线；
- [x] 使用 LayaAir CLI 3.4.0 内置 2D 空项目完成首个 `bytedancegame` 可玩原型：移动、收集、计时、胜负，主包约 2.34 MiB；
- [x] 将已验证的最小 Laya 3.4.0 项目结构提炼为确定性 `douyin-mini-game` GameSpec 生成后端；当前只开放 arcade；
- [x] 增加有界 `build_douyin_mini_game` MCP 工具与 `douyinBuild` capability；真实 Node stdio MCP 已调用官方 LayaAir 3.4.0 并通过校验；
- [ ] 与 Cocos Creator 3.8 LTS 对照 CodeArts 修复成本；
- [ ] 生成 `game.js`、`game.json`、`project.config.json` 与平台适配入口；
- [ ] 增加主包 4MB、整体 20MB、文件类型、远程脚本、HTTPS 域名与 capability 静态校验；
- [ ] 在抖音小游戏开发者工具完成原型导入、预览和上传前检查；
- [ ] 在真实抖音客户端扫码运行并记录脱敏截图、日志、包体和人工干预；
- [x] 研判 CLI 自动化边界：本地生成/构建/静态门禁可 no-GUI；中国抖音小游戏最终预览、提审与发布没有公开的完整 no-GUI 链路；
- [ ] 抖音闭环稳定后实现微信小游戏 target；快手暂不进入 V1 发布门禁。

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
- [x] 保存脱敏实验记录：客户端版本、耗时、RunEvent 序列、人工干预、Task/Run ID、截图与失败边界。该历史执行没有完整 MCP 工具调用序列，基准记录按 `null`/`unknown` 保留，不从事件数反推；

通过标准：Relay 中 Task 为 completed，真实 CodeArts Run 发布规格、预览与验证事件，生成项目可构建且 Chrome 证据通过，记录中不存在密钥或账号隐私。该标准已于 2026-07-18 首次通过；本次没有媒体资产，因此没有 `asset.ready`，Workbench 资产面板应保持空状态而不是伪造结果。

2026-07-18 的安全探测确认 `codearts --version` 为 26.6.2，`run`、`mcp`、`agent`、`models` 和 `serve` 等命令可发现；但 `codearts mcp list/add` 在当前 shell 中因未设置 CLI AK/SK 而拒绝执行，现有后台进程也没有可连接的窗口或本地监听端口。详见 `experiments/2026-07-18-codearts-client-probe/`。

真实执行改用 OAuth TUI，并通过临时 `OPENCODE_CONFIG` 隔离加载本地 MCP，不修改用户全局配置。结果见 `experiments/2026-07-18-codearts-real-e2e/`。

同日升级后再次执行 `codearts --version` 仍得到 26.6.2；真实非交互 `codearts run --format json` 虽以进程退出码 0 结束，但 stdout 明确报告缺少 `CODEARTS_CLI_AK`/`CODEARTS_CLI_SK`，没有复用 OAuth TUI 会话，也没有认领 Task 或调用 MCP。该负向边界按真实结果记录于 `experiments/2026-07-18-codearts-noninteractive-recheck/`，不得把进程退出码 0 误记为 Agent 执行成功。

生成游戏性能基线已加入版本化预算：首屏只加载状态壳，Phaser 与玩法代码异步获取。预算同时记录总量，因此拆分不能掩盖依赖增长；结果见 `experiments/2026-07-18-bundle-split/`。

## Provider 账号级验收

`bun run provider:smoke` 默认只检查所选 Provider 的环境变量是否齐全，不读取或输出变量值。只有显式执行 `bun run provider:smoke -- --execute --providers=qwen,seedream,freesound,tts` 才会产生真实网络请求与潜在费用。媒体验收要求同时选择 `qwen`，以真实 GameSpec 创建带随机后缀的临时项目；检查与执行的脱敏证据都写入 `.gameforge-validation/provider-smoke/evidence.json`，生成项目保留在同一忽略目录供人工复核。TTS 最多查询五次，未完成时以失败/pending 记录，不在 MCP 工具内部轮询。

## 第二轮：Bun TUI MVP

先做 TUI，再决定是否封装桌面 GUI。TUI 直接复用 `@gameforge/contracts`、Run Relay HTTP/SSE 和现有状态 reducer，不新增 Agent 循环。

- [x] 扩展与 React、浏览器 `EventSource` 解耦的共享 Run Relay Client；
- [x] 新增 `apps/tui`，由 Bun 安装、检查、测试和启动；
- [x] 支持 `--base-url`、新建/提交 Task、查看 Task/Run、停止 Run；
- [x] 显示阶段进度、最近日志、GameSpec locale、资产与验证摘要；
- [x] 支持从游标回放后连接 SSE，显式报告序列缺口和 Relay 断线；
- [x] 支持按 Task ID 自动解析 Run 并跟随至终态，无需用户猜测 Run ID；
- [x] 保持 URL 只允许 HTTPS 或 loopback HTTP，禁止凭据、query 和 fragment；
- [x] 增加 Windows/macOS/Linux CI，以及交互 TTY 的退出键、resize 重绘和 raw mode 清理测试。

Windows 本地已使用真实 Relay 验证 `submit → watch(SSE) → stop → 自动退出`，并使用真实 CodeArts completed Run 验证英文规格、预览和 verification 摘要。详见 `experiments/2026-07-18-tui-mvp/`。

## 第二轮后半：桌面 GUI spike

优先评估 Tauri 2 封装现有 React Workbench；Electron 作为生态成熟但体积更大的备选。渲染栈与桌面表面的决策、进入条件和验证要求已记录在 [ADR-0001](./decisions/0001-rendering-and-desktop-surfaces.md)。

桌面 GUI 不改变协议边界：CodeArts 仍是主智能体，Relay 仍只协调状态，MCP 仍是确定性工具。若 TUI 的共享 controller 尚未稳定，不开始桌面打包。

- [x] 新增 `apps/desktop`，复用 Workbench 的生产构建；
- [x] 锁定仓库本地 Tauri CLI，并由 Bun 编排；
- [x] capability 保持零权限，不注册 Tauri plugin、自定义 Rust command 或 invoke handler；
- [x] 新增 `doctor:desktop`，检查 CSP、loopback dev URL、构建目录与最小权限边界；
- [x] 在 Windows 11、MSVC 14.44、Rust/Cargo 1.88.0 和 WebView2 环境完成 `--no-bundle` release 构建；
- [ ] 验证 macOS/Linux 原生构建与 WebView 行为；
- [ ] 设计并验证安装包签名、更新公钥和发布流程；
- [ ] 在明确需求与最小 scope 后才考虑文件选择器或系统通知 plugin。

当前 spike 只证明“现有 Workbench 可被零 IPC 的 Tauri 壳编译为 Windows 可执行文件”，不等同于三平台发行就绪。详见 [桌面壳说明](./desktop.md) 与 `experiments/2026-07-18-tauri-desktop-spike/`。
