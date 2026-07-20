# Task 创建幂等结果

真实生产 Relay 流程：首次创建 Task，停止进程，使用同一状态文件重启，随后分别发送同内容重试和异内容冲突请求。

```json
{
  "firstStatus": 201,
  "retryStatus": 201,
  "sameTaskId": true,
  "sameStartedAt": true,
  "conflictStatus": 409,
  "conflictCode": "task_run_conflict",
  "taskCount": 1
}
```

自动化测试同时覆盖：

- TaskInbox 直接幂等调用；
- HTTP 层相同响应和稳定冲突码；
- 快照恢复后返回原 claimed Task 与 sequence 1 的权威 start event；
- 新快照显式保存 start event，旧快照可在保留事件中存在 start event 时兼容恢复。

## 边界

- 幂等只适用于完全相同的规范化输入；
- 一个 Run ID 永久代表一次任务，不能用于表达新需求；
- HTTP 仍返回与首次创建一致的 201 响应，客户端以 Task ID 判断同一结果；
- 本实验不模拟代理自动重试，重试决策仍在 Workbench 用户或 CodeArts。

## 最终门禁

- `bun run check`：通过
- `bun run test`：137 个测试通过
- `bun run build`：通过
- `bun install --frozen-lockfile`：无变更
- `bun run audit`：0 个生产依赖漏洞
- `git diff --check`：通过
