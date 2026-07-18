# 抖音小游戏 CLI 自动化边界

更新日期：2026-07-18

## 结论

中国抖音小游戏当前公开工具链不能完成 100% no-GUI 全流程。GameForge 可以把工程生成、Laya 编译、产物静态检查和本地质量门禁全部 CLI 化；平台 Runtime 预览、扫码真机、版本提审、审核状态处理、灰度/全量发布仍需要抖音开发者工具或开放平台控制台。官方公开的完整上传—提审—发布 OpenAPI 属于抖音小程序第三方代开发，不能外推到小游戏。

## 工具选择

| 工具 | 对象 | 可用于 GameForge | 决策 |
|---|---|---|---|
| `layaair` 3.4.0 | LayaAir 工程 | create、build `bytedancegame`、平台产物 | 已采用并真实构建 |
| `bun run minigame:validate` | 抖音产物 | 根文件、配置、DOM、符号链接、分包、4/20 MiB | 已采用 |
| `tt-ide-cli` / `tma` | 中国抖音小程序 | 小程序预览、上传、提审 | 不适用于小游戏 |
| `tt-minigame-ide-cli` / `tmg` 2.1.1 | 中国抖音小游戏 | login、open、preview、upload、build-npm | 仅在授权远程操作时使用；preview 会上传 |
| `@ttmg/cli` 0.4.2 | 国际 TikTok Mini Games | init/dev/build/upload、TikTok DevTool | 不用于中国抖音；账号与 Client Key 不兼容 |
| 抖音开发者工具 4.5.3 | 中国抖音小游戏 | 平台编译、模拟器、二维码、上传入口 | 平台验收仍需要 |
| 抖音开放平台控制台 | 中国抖音小游戏 | 测试版本、提审、审核、灰度/全量发布 | 最终流程仍需要 GUI |

## 可自动化流水线

1. CodeArts 生成 GameSpec、资产和玩法代码；
2. 固定版本 LayaAir CLI 创建/更新工程；
3. `layaair build bytedancegame` 生成平台目录；
4. GameForge validator 执行离线确定性门禁；
5. Bun 记录包体、文件哈希、模型、工具调用和人工干预；
6. 获得 AppID 与用户明确授权后，可评估固定 `tt-minigame-ide-cli@2.1.1`，先关闭默认行为上报，再只上传指定测试通道；
7. 抖音开发者工具/控制台完成模拟器、二维码真机、截图、提审和发布。

第 6、7 步会向平台传输代码或账号数据，不能作为默认测试，也不能由 MCP 自动决定。GameForge 不保存登录 session、token、AppSecret 或二维码。

## 为什么不是全 no-GUI

- 中国抖音官方只明确小游戏 CLI 支持指定测试通道上传；没有公开小游戏专用的提审、审核查询、发布 CLI/API 文档。
- `tmg preview` 的语义是先上传再生成二维码，不是离线模拟器。
- Lite 命令 `tmg open <project> --mode=lite` 仍是打开开发者工具，不是无头编译器。
- 版本提审要求选择宿主并提交截图，审核通过后的灰度/全量发布由控制台操作。
- 主体认证、备案、版号、广告与支付资质属于平台工作流，CLI 不能绕过。

## 官方依据

- [抖音小游戏版本提审指引](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/guide/minigame/examineguide)
- [抖音开发者工具 Lite 模式](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/dev-tools/developer-instrument/lite-mode)
- [抖音小游戏开发流程](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/guide/minigame/develop/)
- [抖音小程序命令行工具](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/dev-tools/developer-instrument/development-assistance/ide-cli)（仅用于边界对照）
- [TikTok Mini Games Development Stage](https://developers.tiktok.com/doc/mini-games-development-stage)（国际平台，不是中国抖音）
- [TikTok Mini Games Debugging](https://developers.tiktok.com/doc/debug-your-mini-game)（国际平台，不是中国抖音）

