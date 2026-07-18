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

## 引擎判断

没有找到当前 Phaser 4 的官方抖音/微信导出链。Phaser 官网可见的微信文章来自 2018 年且针对旧版 Phaser CE，只能作为历史参考。实际 Phaser 4.2.1 无 DOM 动态导入探测已失败，并确认广泛依赖浏览器媒体、Canvas、RAF 和可见性 API，因此不继续浏览器 shim 路线。

抖音官方明确写明 Cocos、Laya、Egret 已完成适配并可直接导出抖音小游戏，也提供 Unity WebGL/Wasm、Godot专题和原生 JavaScript/单 Canvas 路线，但没有指定唯一推荐引擎。GameForge V1 选择 LayaAir 3.2 作为首选抖音生成后端：它使用 TypeScript，输出 `game.js`、`game.json`、`projectconfig.json`、`microgame-adapter.js`，并提供可脚本化的 `bytedancegame` 构建任务。Cocos Creator 3.8 LTS 作为成熟编辑器/Asset Bundle 分包备选；Unity WebGL 需要 C#/Unity/StarkSDK 和 Wasm 工具链，留给已有 Unity 项目而非 TS 第一版。

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
