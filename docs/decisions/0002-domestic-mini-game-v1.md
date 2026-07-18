# ADR-0002：第一版面向国内小游戏平台

状态：接受  
日期：2026-07-18
修订：2026-07-18，当前阶段禁止平台 preview、上传、提审和发布

## 决策

GameForge 第一版的可发布游戏目标是抖音小游戏；微信小游戏是第二导出目标，快手小游戏先保留平台适配边界。浏览器 Phaser 项目继续作为快速预览、自动玩法验收和回归基线，但不再代表最终发布产物。

第一版保持统一 GameSpec、玩法参数、资产 Manifest 和 CodeArts/MCP 边界。生成器新增显式 target，不通过 User-Agent 或构建环境猜测：

- `web`：现有 Phaser 4 + Vite 参考运行时；
- `douyin-mini-game`：抖音小游戏发布产物；
- `wechat-mini-game`：第二导出 target，复用平台无关游戏核心并切换到 Laya `wxgame` 与微信平台策略；
- 快手及其他平台只有在官方工具链实验通过后才能进入可执行 target。

抖音产物必须包含 `game.js`、`game.json` 和 `project.config.json`，不得依赖 DOM、HTML 入口或远程 JavaScript。平台差异通过薄 PlatformAdapter 隔离 Canvas、生命周期、输入、网络、音频、登录、分享、广告和支付；商业能力默认关闭，只有配置与资质均满足时才启用。

Phaser 不是抖音或微信当前官方支持的导出器。2026-07-18 兼容性 spike 已触发退出条件：Phaser 4.2.1 在无浏览器全局的动态导入阶段即访问 `window`/`navigator`，初始化与运行还要求 DOM canvas/audio/video、Image、RAF 和可见性事件。GameForge 不维护大范围浏览器 shim 或 fork Phaser；Web target 保留 Phaser，抖音 target 优先采用当前官方下载页的 LayaAir 3.4.0 官方 `bytedancegame` 构建后端，Cocos Creator 3.8 LTS 作为对照与备选。不得把浏览器通过当作小游戏通过。

选择 LayaAir 的原因是其 TypeScript 工作流、官方 `microgame-adapter.js`、固定抖音输出结构，以及 `LayaAirIDE --project=... --script=...` 调用 `IEditorEnv.BuildTask.start("bytedancegame")` 的可脚本化构建链，与 GameForge 的 Bun/TypeScript 生成和 CI 更贴合。Cocos 的抖音支持与 Asset Bundle 分包更成熟，但当前官方资料没有同等明确的抖音无头构建/上传闭环。Unity WebGL/StarkSDK 面向已有 C#/Unity 工程，不作为 TypeScript 第一版后端。

## 原因

抖音、微信和快手小游戏运行时都围绕单 Canvas 与各自 `tt.*`、`wx.*`、`ks.*` API，而非完整浏览器。抖音官方要求根入口/配置文件，未分包总包不超过 20MB；采用分包时主包不超过 4MB。网络还要求 HTTPS、合法域名白名单和备案。现有模板依赖 `document`、HTML 容器、Vite 动态模块以及 Playwright 浏览器接口，不能直接提交平台审核。

LayaAir/Cocos 提供官方小游戏构建支持，但迁移会同时改变运行时、模板、CodeArts 修复模式和现有 Chrome 证据。保留 Phaser Web 后端并让抖音成为独立生成后端，能让统一 GameSpec/资产契约继续复用，同时避免把平台适配风险扩散到现有浏览器闭环。

## 第一版验收

1. GameSpec 与生成请求显式记录 target，Manifest 记录平台和适配器版本。
2. 抖音 target 生成官方要求的根文件，不包含 `index.html`、DOM 入口或开发服务器依赖。
3. 静态校验主包不超过 4MB、整体不超过 20MB，拒绝远程脚本、不安全域名和未声明平台能力。
4. 程序化占位素材下可离线启动；登录、分享、广告、支付均有明确 capability 和未配置降级。
5. Bun 完成契约、生成器和静态产物测试；浏览器 target 的现有 Chrome 验收不退化。
6. 抖音开发者工具成功本地导入，并完成编译器与模拟器检查；记录脱敏日志、包体与人工干预。平台 preview 会上传工程，因此不属于当前验收。
7. 真机扫码、preview、上传、提审、发布、支付、广告或远程资源配置均不执行。若未来改变该范围，必须由用户重新明确授权并新增独立验收记录。

## 非目标

- 第一版不同时承诺所有国内小游戏平台。
- 不把小程序的 Page/DOM 模型与小游戏混用。
- 不在 MCP 中实现发布编排、审核轮询或 Agent 循环。
- 当前不通过 CLI、GUI 或 Agent 发起平台 preview、上传、提审或发布。
- 不因平台提供商业 API 就默认开启广告、支付、用户画像或声音复刻。

## 官方依据

- [抖音小游戏开发指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/bytedance-mini-game)（访问日期：2026-07-18）
- [抖音小游戏网络](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/basic-function/network)（访问日期：2026-07-18）
- [抖音小游戏发布流程](https://developer.open-douyin.com/m/docs/resource/zh-CN/mini-game/guide/minigame/release/)（访问日期：2026-07-18）
- [微信小游戏开发文档](https://developers.weixin.qq.com/minigame/dev/guide/)（访问日期：2026-07-18）
- [快手小游戏开发流程](https://open.kuaishou.com/miniGameDocs/gameDev/start/start.html)（访问日期：2026-07-18）
- [LayaAir 小游戏概览](https://www.layaair.com/3.x/doc/released/miniGame/readme.html)（访问日期：2026-07-18）
- [抖音 Cocos/Laya/Egret 引擎适配](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/game-engine/cocos-laya-egret)（访问日期：2026-07-18）
- [LayaAir 抖音小游戏发布](https://www.layaair.com/3.x/doc/released/miniGame/byteDance/readme.html)（访问日期：2026-07-18）
- [LayaAir 命令行发布](https://www.layaair.com/3.x/doc/released/commandLine/readme.html)（访问日期：2026-07-18）
