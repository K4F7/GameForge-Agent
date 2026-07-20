# Task 创建幂等实验

## 目标

解决 Workbench 提交 Task 时“服务端已成功，但 HTTP 响应丢失”的网络歧义。重复请求必须找回原任务，而不是创建重复 Task 或永久返回无法恢复的 `run_exists`。

## 验收条件

1. Run ID 作为幂等键；
2. 同 Run ID、Prompt、语言返回同一 Task 和同一 `run.started`；
3. 同 Run ID 但内容不同返回稳定 409；
4. 幂等结果跨 Relay 快照恢复有效；
5. 任务总数不增加；
6. 不放宽 Task Prompt Schema 或认领约束。
