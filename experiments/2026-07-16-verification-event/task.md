# 浏览器验收事件任务

让 `verify_game_project` 的结果在 CodeArts/MCP 会话中断后仍可从 Run Relay 恢复，并让 Workbench 展示结构化验收证据。

验收条件：

1. 新事件使用严格、有界 Schema；
2. 不向浏览器事件流暴露绝对本机路径或诊断全文；
3. verifier 返回项目内相对 PNG 证据路径；
4. Relay 持久化并恢复事件；
5. Workbench 归约并显示 outcome、状态、诊断计数和证据路径；
6. 本地完整工作流发布该事件后再完成 Run；
7. 真实 Chrome 验证卡片可见且无控制台错误。
