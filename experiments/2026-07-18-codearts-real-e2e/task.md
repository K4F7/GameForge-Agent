# 真实 CodeArts GameForge 闭环

使用已 OAuth 登录的 CodeArts 26.6.2 TUI 和本地 `gameforge` stdio MCP，处理一条真实 `en-US` Task；禁止调用云模型与媒体 Provider。

原始 Task：

```text
Create a 60-second browser safety game. The player collects two safety kits,
avoids one moving forklift hazard, and wins after collecting both kits.
Use the local deterministic GameForge tools and do not call cloud media providers.
```

验收条件：

1. CodeArts 自身启动 MCP 子进程；
2. Task 由 `claimedBy: codearts` 原子认领；
3. 发布真实 capability 与同语言 GameSpec；
4. 生成独立 Phaser 项目并由 Bun 安装、检查和构建；
5. 系统 Chrome 验证生成项目并保存 PNG；
6. 发布 preview/verification 并完成 Run；
7. Relay Task 最终为 completed；
8. 不读取或记录 OAuth、AK/SK、Token 和私人会话内容。
