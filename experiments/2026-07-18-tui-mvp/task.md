# Bun TUI MVP

为 GameForge 新增不包含 Agent 循环的终端客户端，复用 Run Relay 契约与客户端，支持 Task 提交/读取、Run 回放/停止和 SSE 实时观察。

验收条件：

1. 由 Bun 安装、检查、测试、构建和启动；
2. URL 安全边界与 Relay Client 一致；
3. `--json` 无 ANSI，可用于无 TTY 自动化；
4. Run 摘要显示 locale、资产、预览和验证结果；
5. SSE 强制同 Run、连续 sequence，并在终态自动退出；
6. 使用真实 Relay 完成 submit→watch→stop；
7. 使用真实 CodeArts completed Run 验证摘要。
