# 实验结果

结论：中国抖音小游戏当前不能通过公开工具完成 100% no-GUI 全流程。

已证明可 no-GUI：GameSpec/代码生成、LayaAir `bytedancegame` 构建、GameForge 静态门禁、包体和哈希证据。旧 `tt-minigame-ide-cli` 可登录/打开/远程预览/上传，但没有公开离线小游戏 build/validate；preview 会先上传。小游戏官方只明确 CLI 可指定测试通道上传，未公开小游戏提审、审核查询、灰度或全量发布 CLI/OpenAPI。

`tt-ide-cli` 属于小程序。`@ttmg/cli` 0.4.2 提供 TikTok Mini Games 的 init/dev/build/upload，但使用国际 TikTok Developer Portal 与 client key，不属于中国抖音平台。

中国抖音控制台流程仍要求测试版本扫码、提交截图与宿主、提审，以及审核后灰度/全量发布。小程序第三方代开发虽然有完整 OpenAPI，但不能外推到小游戏。

本轮没有安装新 CLI、没有登录或向平台传输工程。
