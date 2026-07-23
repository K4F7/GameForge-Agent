# 术语表

## OpenCode 原生事件

由 OpenCode 官方 Session/Message/Part/Event 模型产生，并通过官方 SDK 或 SSE 观察的事件。原始事件不得被重写后再作为事实保存。

## Observer

只读观察器。连接一个真实客户端或服务端事件源，保存原始事件并转换为 Evidence 索引；不认领任务、不实现 Agent 循环。

## Sidecar 事件

不属于 OpenCode 原生模型、但由 GameForge 验收层产生的事件，例如 `gameforge.task.claimed`、`gameforge.browser.screenshot` 和 `gameforge.authority.completed`。

## Authority

独立于 TUI 文本和模型自然语言的权威状态来源。当前由 Relay 提供 Task、Run 和 RunEvent；只有 Authority 满足门禁才能通过。

## Evidence

可复核的原始证据及其索引，包括 VT、MCP Audit、Relay 事件、浏览器动作、关键截图和最终结果。

## 薄适配代码

只负责连接官方或第三方组件、做字段映射、ID 关联和边界校验的少量代码；不包含可独立复用的队列、事件总线、VT 引擎或浏览器自动化实现。

## Windows 必需 CI

当前 `PR Gate` 所依赖的唯一完整验证平台。它执行 Bun 安装、严格类型检查、全量测试、构建与 bundle 预算检查；由于真实 ConPTY 与 Playwright 浏览器验收以 Windows 为支持边界，Ubuntu 和 macOS 不属于必需 CI 平台。
