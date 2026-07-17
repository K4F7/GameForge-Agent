# CodeArts 与 OpenCode 同任务基准

使用完全相同的 `en-US` 安全小游戏 Task、同一 GameForge MCP/Relay 和无云媒体边界，比较 CodeArts 26.6.2 与 OpenCode 1.18.3 的事件、工具调用和人工干预。

验收条件：

1. 两边使用相同 Prompt 和 GameSpec目标；
2. 分别记录模型、Task/Run、事件、耗时和人工干预；
3. 失败也保留为结果，不替换模型后冒充同一次通过；
4. 不读取或提交认证凭据。
