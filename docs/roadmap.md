# GameForge Agent 路线图

更新日期：2026-07-21

## 当前产品优先级：抖音小游戏 V1

第一版首要发布目标已从泛浏览器游戏收窄为抖音小游戏；微信小游戏是第二导出目标。浏览器 Phaser 项目继续承担快速预览和 Chrome 回归，但不能作为小游戏平台验收。决策与官方约束见 [ADR-0002](./decisions/0002-domestic-mini-game-v1.md)。

- [x] 为生成请求、计划和 Manifest 增加显式 `web` / `douyin-mini-game` / `wechat-mini-game` target；旧请求默认 `web`，未实现平台 target 会明确失败；
- [x] 完成 Phaser 4 抖音小游戏无 DOM 兼容性 spike；动态导入与初始化触发广泛浏览器依赖，按 ADR 停止 shim 路线；
- [x] 使用 LayaAir CLI 3.4.0 内置 2D 空项目完成首个 `bytedancegame` 可玩原型：移动、收集、计时、胜负，主包约 2.34 MiB；
- [x] 将已验证的 Laya 3.4.0 项目结构提炼为确定性 `douyin-mini-game` GameSpec 生成后端；0.12.0 已开放 arcade/platformer/puzzle/shooter/strategy 五种机制并逐个通过官方 CLI 构建；
- [x] 增加受限 headless Laya 逻辑宿主，直接执行同一生成 `Main.ts`，以可控输入和时钟覆盖五种 genre 的移动、碰撞、伤害与胜负遥测；该证据不替代 DevTool/真机；
- [x] 将 headless Laya 宿主提升为 `verify_minigame_gameplay` 生产 MCP 能力：只接受受管固定模板哈希，对抖音/微信五 genre 分别发布无视觉字段的 `gameplay.verified` 双终态证据，Workbench/TUI 明确标记 no-render；
- [x] 增加有界 `build_douyin_mini_game` MCP 工具与 `douyinBuild` capability；真实 Node stdio MCP 已调用官方 LayaAir 3.4.0 并通过校验；
- [x] 完成 Cocos Creator 3.8 LTS 官方资料、仓库改动面与 CodeArts 修复成本对照，并用 Creator 3.8.8 官方 Empty2D 模板真实构建 `bytedance-mini-game`：抖音 DevTool 4.5.4 已本地导入、加载场景并跑通竖屏交互；该证据尚未实现仓库 Cocos 生产 target；
- [x] 通过官方 LayaAir 3.4.0 构建生成 `game.js`、`game.json`、`project.config.json` 与平台适配入口；
- [x] 增加主包 4MB、整体 20MB、文件类型、远程脚本、HTTPS 域名与 capability 静态校验；生成器 0.12.0 默认声明离线且关闭登录、分享、广告和支付；
- [x] 增加纯 CLI `minigame:handoff`：validator 前后双快照、逐文件 SHA-256、聚合摘要和无路径 JSON；`build.ready`/TUI 显式标记远程操作禁止与 DevTool 未验收；
- [x] 将 Seedream 图片、Freesound 音效和火山 TTS/BGM 的统一 Asset Store 桥接到 Laya `resources/assets/`；官方构建后逐项复核 Manifest、字节数和 SHA-256；
- [x] 增加 `tt-minigame-ide-cli` 2.1.1 官方 `bin/tmg.js --version` 诊断与条件 MCP capability；明确拒绝小程序 `tma`，不开放登录、打开、项目 version、配置、预览或上传命令；
- [x] 在抖音小游戏开发者工具 4.5.4 完成受管原型本地导入、普通编译与模拟器检查；修复平台运行时持续时间非有限值导致的 HUD `undefined`/`NaN`，重新编译后问题计数为零且倒计时正常；未执行平台 preview 或上传；
- [x] 完成一次 Cocos Creator 3.8.8 → `bytedance-mini-game` → 抖音 DevTool 4.5.4 的受限本地回环；模拟器验证场景、TypeScript、竖屏渲染、输入、计时、碰撞、计分和失败终态，记录 AssetDB 热刷新、CLI 参数类型、stdout 生命周期、分辨率和包体问题；
- [ ] 真实抖音客户端扫码运行因依赖远程 preview 暂缓；若未来改变策略，需再次明确授权并记录脱敏截图、日志、包体和人工干预；
- [x] 研判 CLI 自动化边界：本地生成/构建/静态门禁可 no-GUI；中国抖音小游戏最终预览、提审与发布没有公开的完整 no-GUI 链路；
- [x] 实现 `wechat-mini-game` 第二导出 target：复用同一 Laya TypeScript 玩法和 Asset Store，增加固定 `wxgame` 构建、微信策略/API 静态校验、MCP capability 与 target-aware Workbench/TUI；五种 genre 已逐一通过真实 LayaAir CLI 3.4.0 构建；
- [ ] 在微信开发者工具导入 `release/wxgame`，完成编译、预览与真机扫码证据；快手暂不进入 V1 发布门禁。

2026-07-20 首次探针确认当前 Windows 环境安装抖音开发者工具 4.5.4 且客户端可启动，但未登录时停在前置管理页；证据见 `experiments/2026-07-20-douyin-devtool-login-gate/`。用户随后自行完成登录并进入项目工作区，受控实验完成本地导入、编译器与模拟器验收；证据见 `experiments/2026-07-20-douyin-devtool-local-validation/`。

## 抖音 MVP 后产品中心：Web 2D + 单一 GUI

当前抖音小游戏 MVP 只负责关闭一次平台端到端验证，不继续扩大 Cocos、LayaAir IDE 或平台 GUI 集成。GUI 第一版直接运行固定版本的原版 OpenChamber，并通过其 OpenCode-compatible server 接口连接 CodeArts；GameForge 的 Task/Run、预览、Diff、资产候选与验证证据留到后续通过 Runtime API、MCP 或插件接入。

- [ ] 完成 [Web 2D 与专业 Agent GUI PRD](./prd-web2d-opencodegui.md) 的首批契约；
- [ ] 完成 [Web 2D 专业 Agent GUI MVP](./mvp-web2d-opencodegui.md)；
- [ ] 保存 `@程序员` Web 2D Bug 修复与 `@美术` 候选资产两个真实 CodeArts 实验；
- [ ] 建立 Specialist Request、Finding 与 Handoff 的客户端无关契约后，再评估真实专业 Agent 委派；
- [ ] 保持平台后端为可选导出能力，不让日常生产依赖平台编辑器连接。

## 第一轮：真实 CodeArts 闭环

目标是让 CodeArts Agent 而不是测试客户端完成一次 Workbench Task。

- [x] 在 Windows 安装 CodeArts Agent 客户端；
- [x] 确认当前安装版本与 CLI/TUI 入口：CodeArts 26.6.2，使用 `%USERPROFILE%\.codeartsdoer\installers\codearts.cmd` 启动；
- [x] 使用 OAuth 登录的 CodeArts TUI 完成授权；非交互 `run`/`mcp` 子命令仍单独要求 CLI AK/SK，凭据未进入仓库；
- [x] 使用 `bun install --frozen-lockfile && bun run build && bun run doctor` 验证本地前置条件；
- [x] 按 `docs/codearts-quickstart.md` 通过隔离配置启动 `gameforge` stdio MCP；
- [x] 从本地 Task Inbox 提交一个 `en-US` Task；
- [x] 由 CodeArts 实际列出、认领并回放该 Task；
- [x] 新增 `create_game_task`，并由真实 CodeArts 26.6.2 非交互 Agent 在无 Workbench 的情况下原子创建、认领和回放 Task；
- [x] 无百炼账号时由 CodeArts 按 Skill 手工构造同 locale 规格并发布 `spec.ready`；
- [x] CodeArts 生成项目、运行构建与浏览器验收、发布 `preview.ready`/`verification.ready` 并完成 Run；
- [x] 由真实非交互 CodeArts 完成抖音小游戏规格、受管生成、双终态玩法验收、LayaAir 3.4.0 静态构建和 Run 完成；
- [x] 由独立 OpenCode 1.18.3 + 腾讯 Hy3 完成同一抖音任务，并生成同 fingerprint、双端 16 次 MCP 调用且零错误的机械对比报告；
- [x] 保存脱敏实验记录：客户端版本、耗时、RunEvent 序列、人工干预、Task/Run ID、截图与失败边界。该历史执行没有完整 MCP 工具调用序列，基准记录按 `null`/`unknown` 保留，不从事件数反推；

通过标准：Relay 中 Task 为 completed，真实 CodeArts Run 发布规格、预览与验证事件，生成项目可构建且 Chrome 证据通过，记录中不存在密钥或账号隐私。该标准已于 2026-07-18 首次通过；本次没有媒体资产，因此没有 `asset.ready`，Workbench 资产面板应保持空状态而不是伪造结果。

2026-07-18 的初始安全探测确认 `codearts --version` 为 26.6.2，`run`、`mcp`、`agent`、`models` 和 `serve` 等命令可发现；当时 shell 尚未继承用户级 CLI AK/SK，因此 `mcp list/add` 被拒绝。该历史边界见 `experiments/2026-07-18-codearts-client-probe/`。

真实执行改用 OAuth TUI，并通过临时 `OPENCODE_CONFIG` 隔离加载本地 MCP，不修改用户全局配置。结果见 `experiments/2026-07-18-codearts-real-e2e/`。

同日升级后再次执行 `codearts --version` 仍得到 26.6.2；真实非交互 `codearts run --format json` 虽以进程退出码 0 结束，但 stdout 明确报告缺少 `CODEARTS_CLI_AK`/`CODEARTS_CLI_SK`，没有复用 OAuth TUI 会话，也没有认领 Task 或调用 MCP。该负向边界按真实结果记录于 `experiments/2026-07-18-codearts-noninteractive-recheck/`，不得把进程退出码 0 误记为 Agent 执行成功。

重新打开环境后，用户级 AK/SK 已能只读注入 CodeArts 子进程；`codearts models` 实际返回 DeepSeek V3.2、GLM-4.7 ArkTS、GLM-5 和 GLM-5.1。修复 OpenCode-compatible 配置的非标准 `cwd` 与空 Relay token 后，非交互 GLM-5.1 Agent 在 39.3 秒内真实完成 `create_game_task → claim_game_task → replay_game_run`，三次 MCP Audit 均成功。详见 `experiments/2026-07-18-codearts-headless-task-create/`。

同日，非交互 DeepSeek V3.2 Agent 又在约 342.1 秒内完成一个中文抖音街机收集小游戏的 Task 创建、认领、规格、项目生成、玩法双终态验收、LayaAir 3.4.0 构建和 Run 完成。Relay 保存 6 个连续事件，MCP Audit 保存 16 次成功调用；严格基准 record 不含 Prompt、日志、模板哈希或本机路径。详见 `experiments/2026-07-18-codearts-douyin-full/`。该项关闭“真实 CodeArts 无 GUI 本地小游戏生产”缺口，但 DevTool、真机和平台上传仍保持未完成。

同一规范化任务随后由 OpenCode 1.18.3 的 `opencode/hy3-free` 在 92.181 秒墙钟内完成，Task 如实由 `opencode` 认领，6 个事件与 16 次 MCP 调用均零错误。Benchmark 只依据相同 definition fingerprint 和两端 passed gameplay/build proof 判定可比，不把单次耗时推广为模型排行榜。详见 `experiments/2026-07-18-codearts-opencode-douyin-comparison/`。

生成游戏性能基线已加入版本化预算：首屏只加载状态壳，Phaser 与玩法代码异步获取。预算同时记录总量，因此拆分不能掩盖依赖增长；结果见 `experiments/2026-07-18-bundle-split/`。

## Provider 账号级验收

当前阶段按用户决策只使用 CodeArts 内置 DeepSeek/GLM，外部百炼、Seedream、Freesound、豆包 TTS 与 MiniMax 账号级执行暂停。适配器和 smoke 门禁保留，但不得因本机意外存在环境变量就擅自执行 `--execute`；游戏继续使用程序化占位素材。

`bun run provider:smoke` 默认只检查所选 Provider 的环境变量是否齐全，不读取或输出变量值。只有显式执行 `bun run provider:smoke -- --execute --providers=qwen,seedream,freesound,tts,music` 才会产生真实网络请求与潜在费用。媒体验收要求同时选择 `qwen`，以真实 GameSpec 创建带随机后缀的临时项目；检查与执行的脱敏证据都写入 `.gameforge-validation/provider-smoke/evidence.json`，生成项目保留在同一忽略目录供人工复核。MiniMax 配乐固定纯音乐且不自动重试生成 POST；TTS 最多查询五次，未完成时以失败/pending 记录，不在 MCP 工具内部轮询。

## 第二轮：Bun TUI MVP

先做 TUI，再决定是否封装桌面 GUI。TUI 直接复用 `@gameforge/contracts`、Run Relay HTTP/SSE 和现有状态 reducer，不新增 Agent 循环。

- [x] 扩展与 React、浏览器 `EventSource` 解耦的共享 Run Relay Client；
- [x] 新增 `apps/tui`，由 Bun 安装、检查、测试和启动；
- [x] 支持 `--base-url`、新建/提交 Task、查看 Task/Run、停止 Run；
- [x] 显示阶段进度、最近日志、GameSpec locale、资产与验证摘要；
- [x] 支持从游标回放后连接 SSE，显式报告序列缺口和 Relay 断线；
- [x] 支持按 Task ID 自动解析 Run 并跟随至终态，无需用户猜测 Run ID；
- [x] Workbench 与 TUI 消费持久化 `build.ready`，按 target 显示抖音/微信 CLI、包体、方向、能力和媒体 revision；TUI 额外显示产物聚合 SHA-256、远程操作与 DevTool 状态，不泄露绝对输出路径；
- [x] 保持 URL 只允许 HTTPS 或 loopback HTTP，禁止凭据、query 和 fragment；
- [x] 增加 Windows/macOS/Linux CI，以及交互 TTY 的退出键、resize 重绘和 raw mode 清理测试。

Windows 本地已使用真实 Relay 验证 `submit → watch(SSE) → stop → 自动退出`，并使用真实 CodeArts completed Run 验证英文规格、预览和 verification 摘要。详见 `experiments/2026-07-18-tui-mvp/`。

## 第二轮后半：桌面 GUI spike

优先评估 Tauri 2 封装现有 React Workbench；Electron 作为生态成熟但体积更大的备选。渲染栈与桌面表面的决策、进入条件和验证要求已记录在 [ADR-0001](./decisions/0001-rendering-and-desktop-surfaces.md)。

2026-07-20 起，用户指定 MIT 许可的 [OpenChamber](https://github.com/openchamber/openchamber) 作为后续 GUI 基线；2026-07-21 重新核验官方仓库后，当前固定提交为 `f9ad0de3e5e7cf281dd4966391409f3e19de4e79`（1.16.2）。第一阶段不复制组件、不重画界面，也不替换其 OpenCode SDK/session 状态，而是原样运行 OpenChamber Web 并连接 CodeArts server；第二阶段优先从 OpenChamber 已有 Runtime API、MCP、commands 或插件边界接入 GameForge，只有公开边界不足时才评估最小上游改动。详见 [GUI 方向](./gui-direction.md)。

桌面 GUI 不改变协议边界：CodeArts 仍是主智能体，Relay 仍只协调状态，MCP 仍是确定性工具。若 TUI 的共享 controller 尚未稳定，不开始桌面打包。

- [x] 新增 `apps/desktop`，复用 Workbench 的生产构建；
- [x] 锁定仓库本地 Tauri CLI，并由 Bun 编排；
- [x] capability 保持零权限，不注册 Tauri plugin、自定义 Rust command 或 invoke handler；
- [x] 新增 `doctor:desktop`，检查 CSP、loopback dev URL、构建目录与最小权限边界；
- [x] 在 Windows 11、MSVC 14.44、Rust/Cargo 1.88.0 和 WebView2 环境完成 `--no-bundle` release 构建；
- [ ] 完成 OpenChamber 固定版本的源码、依赖许可证、安全面与构建体积清单；
- [x] 固定原版 OpenChamber 1.16.2，建立隔离 checkout、启动器和 CodeArts 兼容性探针；
- [ ] 从 OpenChamber 的 Runtime API、MCP、commands 或插件边界接入 GameForge Relay/RunEvent；
- [ ] 仅在公开扩展边界不足时评估最小上游改动，并通过恢复、CSP、bundle、浏览器 smoke 与桌面门禁；
- [ ] 验证 macOS/Linux 原生构建与 WebView 行为；
- [ ] 设计并验证安装包签名、更新公钥和发布流程；
- [ ] 在明确需求与最小 scope 后才考虑文件选择器或系统通知 plugin。

当前 spike 只证明“现有 Workbench 可被零 IPC 的 Tauri 壳编译为 Windows 可执行文件”，不等同于三平台发行就绪。详见 [桌面壳说明](./desktop.md) 与 `experiments/2026-07-18-tauri-desktop-spike/`。

## Cocos Creator 3.8 LTS 对照结论

2026-07-21 先完成 Cocos Creator 3.8 LTS 官方文档与仓库改动面对照，随后安装 Creator 3.8.8，以官方 Empty2D 模板创建固定场景和 TypeScript 游戏，使用 Creator CLI 构建 `bytedance-mini-game`，并在抖音 DevTool 4.5.4 中完成本地导入和模拟器运行。游戏以竖屏显示，点击开始后计时、生成、碰撞、计分和失败终态均真实推进；未执行平台 preview、真机、上传、提审或发布。

这次 spike 只保留为外部编辑器兼容性证据，不再导向默认 Cocos 生产 target。Cocos 的 AssetDB、CLI、编辑器状态和 DevTool 链路会增加 Agent 连接与复现依赖；除非未来出现无法由 Web 2D 满足的明确需求并重新立项，否则不实现 Cocos MCP、编辑器桥或 GUI 状态集成。当前仓库的 LayaAir 能力也降为可选平台导出边界，产品主线以 [Web 2D 与专业 Agent GUI PRD](./prd-web2d-opencodegui.md) 为准。资料对照见 `experiments/2026-07-21-cocos-creator-3-8-comparison/`，真实回环证据见 `experiments/2026-07-21-cocos-creator-douyin-local-loop/`。
