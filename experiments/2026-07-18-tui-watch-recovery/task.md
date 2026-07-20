# 实验任务

日期：2026-07-18

## 输入任务

让同一个 Bun TUI `watch` 进程在 Run Relay 重启后保留最后连续 sequence，通过有限退避 replay 补齐事件并恢复 SSE；终态后自动退出，JSON stdout 不混入状态文字。

## 验收条件

1. 初始历史、恢复回放和实时事件只输出一次；
2. cursor 只在事件成功交给输出/摘要后推进；
3. 网络、EOF、gap、429/5xx 有限重试；409/410/协议错误立即失败；
4. `q`/Ctrl-C 在等待期间仍可中止；
5. JSON stdout 只有事件，重试状态进入 stderr；
6. 真实持久化 Relay 停止/重启后，同一 watcher 收到终态并以 0 退出；
7. 不调用 CodeArts、MCP 或云 Provider。

## 模型与人工干预

- 实现模型：GPT-5 Codex；
- 子代理：审计 TUI 协议和真实验证步骤；
- 云模型/Provider：未调用；
- 人工干预：无。
