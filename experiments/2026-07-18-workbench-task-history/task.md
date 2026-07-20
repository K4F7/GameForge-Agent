# Workbench Task 历史恢复

为 Workbench 增加只读 Task 历史：从 Relay 获取最近 20 项，选择旧 Task 后清空当前 UI 投影，并从 sequence 0 回放其权威 RunEvent，不重新认领、不修改或停止旧 Run。

验收条件：严格解析 Task 列表；恢复 Prompt、语言、`projectId`、Task/Run ID；回放隔离旧 UI 状态；真实 Relay 与浏览器交互通过；整仓门禁通过。
