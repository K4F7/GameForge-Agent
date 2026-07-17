# 媒体角色前置契约任务

让 MCP 暴露的媒体工具参数与 Asset Store 的角色—来源约束完全一致，避免 CodeArts 选择无效角色后仍消耗一次真实云请求。

验收条件：

1. Seedream 图片只接受 `player`、`collectible`、`hazard`、`background`；
2. `voice`、`bgm` 和音效角色不能进入图片 Provider；
3. Freesound 仅接受音效或 BGM 角色；
4. TTS 素材化固定写入 `voice`；
5. 真实 MCP SDK 客户端证明无效请求不调用 Provider 或 Store；
6. Bun 整仓门禁通过。
