# 国内小游戏平台调研与 GameForge V1 范围

更新日期：2026-07-18

## 平台比较

| 平台 | 第一版定位 | 官方运行时与工程 | 已确认关键限制 | GameForge 决策 |
|---|---|---|---|---|
| 抖音小游戏 | 首要发布目标 | 单 Canvas、`GameGlobal`、`tt.*`；根目录 `game.js`、`game.json`、`project.config.json` | 主包 4MB；整体目录 20MB；HTTPS 合法域名、不可 IP/localhost/端口、TLS 1.2+ | 首个原生 target，开发者工具与真机验收 |
| 微信小游戏 | 第二导出目标 | 无 DOM 的 JS 小游戏环境、Canvas/WebGL、`wx.*`；同类根入口/配置 | 主包和分包额度会调整；远程脚本受限，网络需合法域名 | 抖音平台核心稳定后复用适配边界 |
| 快手小游戏 | 后续目标 | Canvas/WebGL、`ks.*`，官方列出 Cocos/Laya/Egret | 官方公开页未核实稳定包体数值 | 只定义能力接口，不承诺第一版发布 |
| 支付宝/淘宝/华为/OPPO | 观察 | 均有各自开发工具、运行时和商业能力 | 技术与资质规则分散且动态 | 不进入 V1 验收矩阵 |

## 抖音小游戏需要覆盖的能力

- 基础：Canvas、触摸、生命周期、文件/资源、音频、设备信息；
- 网络：`tt.request`、下载、上传、WebSocket，域名白名单和超时；
- 社交：`tt.login`、主动/被动分享、好友邀请；
- 商业：激励广告、虚拟支付与游戏币；默认关闭并独立验收主体资质；
- 工具链：独立小游戏 IDE 创建/导入、预览二维码、真机调试、上传、后台审核和发布；
- 合规：名称、主体认证、内容审核、隐私、未成年人保护、版号与商业化资格。

平台“提供 API”不等于账号已经获权。GameForge 只生成 capability 声明与调用边界，不保存 AppSecret、不自动申请资质、不提交审核或发布。

## 对现有仓库的影响

现有 `@gameforge/generator` 和 `@gameforge/game-verifier` 强依赖 Vite、DOM、HTML 容器与 Chrome。可复用的是 GameSpec、五种玩法逻辑、资产角色/哈希、确定性事务、RunEvent 和 CodeArts 工作流。需要新增：

1. 生成契约中的显式 platform target；
2. 平台无关玩法核心和 `PlatformAdapter`；
3. 抖音根入口、配置、资源/分包生成器；
4. 包体、文件、域名、远程脚本和 capability 静态校验器；
5. 开发者工具导入/预览的人工或受控 CLI 证据；
6. 真机验收记录，与浏览器 Chrome 证据并列而不是互相替代。

生成器 0.11.0 已将 `gameforge-platform.json` 和运行时资产 Manifest 放入 Laya `assets/resources/`，官方构建后位于产物 `resources/`。第一版模板声明离线运行，网络、登录、分享、广告和支付全部关闭；静态校验器会把实际远程 URL 和常见 `tt.*` 用法与声明交叉核对，并校验每个发布媒体的字节数与 SHA-256。域名校验只能证明产物内运行时 URL 使用 HTTPS、非本地/IP/端口且出现在声明中，不能证明开发者后台已配置合法域名或服务器满足 TLS 1.2，这两项仍属于账号级平台验收。

## 引擎判断

没有找到当前 Phaser 4 的官方抖音/微信导出链。Phaser 官网可见的微信文章来自 2018 年且针对旧版 Phaser CE，只能作为历史参考。实际 Phaser 4.2.1 无 DOM 动态导入探测已失败，并确认广泛依赖浏览器媒体、Canvas、RAF 和可见性 API，因此不继续浏览器 shim 路线。

抖音官方明确写明 Cocos、Laya、Egret 已完成适配并可直接导出抖音小游戏，也提供 Unity WebGL/Wasm、Godot专题和原生 JavaScript/单 Canvas 路线，但没有指定唯一推荐引擎。GameForge V1 选择当前官方下载页的 LayaAir 3.4.0 作为首选抖音生成后端：它使用 TypeScript，输出 `game.js`、`game.json`、`projectconfig.json`、`microgame-adapter.js`，并提供可脚本化的 `bytedancegame` 构建任务。Cocos Creator 3.8 LTS 作为成熟编辑器/Asset Bundle 分包备选；Unity WebGL 需要 C#/Unity/StarkSDK 和 Wasm 工具链，留给已有 Unity 项目而非 TS 第一版。LayaAir 3.x IDE 官方明确要求登录账号，且发布器不以 npm 包或 GitHub release 独立提供，因此安装和首次登录是本地工具链前置。

本机随后安装并只读核验 Layabox 官方 `layaair-cli` 3.4.0。与完整 IDE 不同，CLI 直接提供 `create`、`build`、`validate`、`run`，内置 2D/3D 空项目，并在真实项目中列出 `bytedancegame`、`wxgame`、OPPO、vivo、支付宝、淘宝等构建目标。使用内置 2D 空项目挂载纯代码 `Laya.Scene` 后，`build bytedancegame` 成功输出官方适配库和根文件；GameForge 校验报告为 33 个文件、2,341,386 bytes、无分包、portrait。该结果证明本地构建链可用，不证明抖音 IDE 或真机运行。

抖音 CLI 需要区分：`tt-ide-cli` 暴露 `tma`，官方 Lite 文档只把它用于小程序；小游戏对应 `tt-minigame-ide-cli` 的 `tmg`。`tmg` 2.1.1 提供 login/open/preview/upload/build-npm，但没有独立的本地小游戏 build/validate；preview 明确先上传再扫码，并从 2.0.0 起默认收集行为数据，可用 `tmg set-config --allow-report-event no` 关闭。故本地门禁不安装或调用它，避免在未授权时登录/上传。官方新 `ttmg dev` 能启动编译和预检查，但仍要求 DevTool、Chrome、有效 AppID、登录与网络，不能替代平台工具。

## 官方资料

- [抖音小游戏开发指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/bytedance-mini-game)
- [抖音开发与发布流程](https://developer.open-douyin.com/m/docs/resource/zh-CN/mini-game/guide/minigame/develop/)
- [抖音小游戏网络](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/basic-function/network)
- [抖音小游戏分享](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/social-interaction/social-share-guide)
- [抖音小游戏支付接入](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/payment/access-process)
- [微信小游戏文档](https://developers.weixin.qq.com/minigame/dev/guide/)
- [微信小游戏 API](https://developers.weixin.qq.com/minigame/dev/api/)
- [快手小游戏开发流程](https://open.kuaishou.com/miniGameDocs/gameDev/start/start.html)
- [快手小游戏 API](https://ks-game-docs.kuaishou.com/minigame/api/api.html)
- [LayaAir 抖音小游戏发布](https://layaair.layabox.com/3.x/doc/released/miniGame/byteDance/readme.html)
- [Cocos Creator 微信小游戏发布](https://docs.cocos.com/creator/3.2/manual/zh/editor/publish/publish-wechatgame.html)
