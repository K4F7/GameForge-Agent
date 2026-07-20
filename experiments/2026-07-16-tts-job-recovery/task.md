# TTS 作业中断恢复任务

验证 CodeArts/MCP 会话在异步 TTS submit 之后、素材落盘之前中断时，后续会话能够从 Run Relay 的结构化事件恢复签名 job handle，并继续单次查询或素材化，而不在 MCP 工具内部实现轮询。

验收条件：

1. `voice.job.updated` 使用严格 Schema，状态限定为 processing、succeeded 或 failed；
2. job handle 经过签名 Schema 校验并绑定项目；
3. 新 MCP Client 可从回放事件恢复 handle 并执行一次 query；
4. Workbench 不保存、不显示 job handle，只显示非敏感状态摘要；
5. Relay 持久化可保存和恢复该事件；
6. 使用 Bun 完成目标测试和整仓门禁。
