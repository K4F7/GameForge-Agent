# 实验任务

日期：2026-07-18

## 输入任务

让 Workbench 在 CodeArts 长任务期间遇到 Relay/SSE 短暂断线或 sequence 缺口时，从最后连续游标自动回放并恢复实时流；重试必须有界，且不得把状态恢复实现成新的 Agent 循环。

## 验收条件

1. `after` 始终等于最后成功交给 reducer 的 sequence；
2. SSE error 和 gap 都关闭旧 stream，再调用 JSON replay，随后使用新游标建流；
3. 重复事件不二次 dispatch，缺失事件按序补齐；
4. 自动重试为有限退避，409/410 不盲目重试；
5. 终态事件关闭 stream；
6. 耗尽后显示可访问的错误状态与手动“恢复连接”；
7. 模拟测试、浏览器检查与整仓门禁通过。

## 模型与人工干预

- 实现模型：GPT-5 Codex；
- 云模型/Provider：未调用；
- 子代理：分别审计 Workbench 客户端与 Relay 协议；
- 人工干预：无。
