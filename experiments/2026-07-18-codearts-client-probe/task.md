# CodeArts 客户端安全探测

确认用户已安装的真实 CodeArts Agent 客户端版本、启动入口、OpenCode 实现指纹、CLI/MCP 可用状态和执行 GameForge 端到端实验的剩余前置条件。

验收条件：

1. 找到真实可执行文件和官方 CLI 版本输出；
2. 只读取启动 shim、公开配置 Schema 和包元数据，不读取 Token、auth、permission 内容或私人会话；
3. 确认 `run`、`mcp`、`agent` 等命令是否存在；
4. 判断是否可在当前 shell 中配置/调用 MCP；
5. 不把“已安装”冒充 Task→MCP→RunEvent 已通过；
6. 记录完成真实闭环所需的最小外部条件。
