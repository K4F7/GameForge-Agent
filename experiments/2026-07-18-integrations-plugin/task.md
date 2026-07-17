# Integration 与薄 OpenCode Plugin

为 CodeArts/OpenCode 提供无绝对路径、无密钥的配置模板和动态启动器，并实现不承载 GameForge 核心的薄 OpenCode Plugin。

验收条件：

1. `opencode.json.example` 可提交且无本机绝对路径/密钥；
2. 权限区分只读 allow 与写入 ask；
3. CodeArts/OpenCode 启动器动态解析仓库根和输出目录；
4. dry-run 不启动客户端且输出脱敏计划；
5. Plugin 只做 MCP/Relay 检测、会话提示、只读状态工具和完成通知；
6. 不把 Session idle 当成 Relay Run completed；
7. 单元测试、类型检查、构建和整仓门禁通过。
