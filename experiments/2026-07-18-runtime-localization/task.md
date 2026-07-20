# 双语生成运行时任务

使用同一个固定 arcade 需求生成 `en-US` 游戏，证明 Task/GameSpec locale 最终影响静态 HTML、Phaser HUD 与浏览器语言；同时验证旧 GameSpec 缺少 locale 时仍默认中文。

验收条件：

1. `GameSpec.locale` 接受 `zh-CN`/`en-US` 并保持旧规格兼容；
2. 英文生成项目的静态 `<html lang>` 和 aria-label 为英文；
3. 真实系统 Chrome 中 `document.documentElement.lang` 为 `en-US`；
4. 首个可玩画面显示英文 `Progress`、`Lives` 和控制提示，无固定中文 HUD；
5. Canvas 非空白、telemetry 为 running、控制台/页面/请求错误均为 0；
6. Bun 目标测试和整仓门禁通过；
7. 不把本地 MCP Client 冒充真实 CodeArts Agent。
