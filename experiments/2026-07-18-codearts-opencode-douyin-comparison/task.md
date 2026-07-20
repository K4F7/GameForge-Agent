# 任务

使用与 `experiments/2026-07-18-codearts-douyin-full/` 完全相同的规范化任务，让独立 OpenCode 1.18.3 非交互客户端完成抖音小游戏本地生产 Run，并与真实 CodeArts 26.6.2 记录机械比较。

验收条件：

1. OpenCode 如实以 `agentId: "opencode"` 创建、认领并完成新 Task；
2. 腾讯 Hy3 精确 host target 通过模型路由工具解析，不冒充 CodeArts primary；
3. MCP Audit 绑定同一 Task/Run，16 次预期调用全部成功；
4. Relay 只包含 sequence 1–6 的 capabilities、spec、gameplay、build 与完成证据；
5. 同一 BenchmarkDefinition fingerprint 下，两端均具备可比较的玩法与构建 proof；
6. 不调用媒体 Provider，不使用内置修改或 shell 工具，不声明 DevTool、真机、上传或发布。
