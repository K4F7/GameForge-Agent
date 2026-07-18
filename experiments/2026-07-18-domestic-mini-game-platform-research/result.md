# 实验结果

状态：调研完成，平台实现待开始。

决策：抖音小游戏为第一版首要发布目标，微信小游戏为第二导出目标，快手暂保留适配边界。现有 Phaser+Vite 项目只作为浏览器参考运行时；必须新增显式平台 target、非 DOM 入口、平台 API 适配、包体/域名静态检查和开发者工具/真机证据。

抖音官方确认根文件 `game.js`、`game.json`、`project.config.json`，单 Canvas，未分包整体 20MB；使用分包时主包 4MB、整体目录 20MB。网络只允许配置过的 HTTPS 合法域名，不允许 IP、localhost 或端口。登录、分享、广告与支付按账号资质独立开通，GameForge 不自动启用。

未发现当前 Phaser 4 官方抖音/微信导出器，因此先进行有退出条件的兼容性 spike。浏览器构建或 Chrome 验收不能作为平台发布通过证据。

完整来源与边界见 `docs/domestic-mini-game-platforms.md` 和 ADR-0002。

