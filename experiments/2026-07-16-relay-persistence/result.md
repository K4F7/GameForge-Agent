# Run Relay 持久化结果

## 自动化测试

- 严格快照保存/恢复 claimed Task 与连续 RunEvent；
- 完成后再次保存/恢复 completed Task 与 `run.completed`；
- 两个并发保存请求按队列执行，最终磁盘状态为最新 Task；
- 相对路径和无效快照被拒绝；
- HTTP mutation 等待持久化回调，GET 不触发写入。

目标结果：Run Relay 5 个测试文件、25 个测试通过；其中额外覆盖 Task/Run 终态不一致快照拒绝。

## 真实生产进程重启

执行生产 `packages/run-relay/dist/index.js`，依次完成：

```text
创建 queued Task
→ codearts 认领
→ 发布 phase.started(sequence 2)
→ 停止并重启 Relay
→ 恢复 claimed Task 与 run.started/phase.started
→ 完成 Run
→ 再次停止并重启 Relay
→ 恢复 completed Task 与 run.completed(sequence 3)
```

真实输出摘要：

```json
{
  "restoredTask": "claimed",
  "restoredEvents": ["run.started", "phase.started"],
  "completedEvent": "run.completed",
  "terminalTask": "completed",
  "terminalEvents": ["run.completed"]
}
```

## 边界

- 这是单进程、单机 JSON 快照，不支持多实例共同写入；
- 不恢复 SSE socket，客户端必须按游标重连；
- 磁盘写入失败时内存可能领先于最后成功快照，应停止服务并对账；
- 状态文件包含 Prompt 和日志，可能具有业务敏感性；
- 未宣称具备数据库事务或高可用能力。

## 真实 Chrome SSE 重连

从允许的 `http://localhost:4173` 页面建立原生 EventSource，读取 sequence 1；停止并重启使用状态文件的生产 Relay，随后发布 sequence 2。浏览器结果：

```json
{
  "opens": 2,
  "errors": 1,
  "sequences": [1, 1, 2]
}
```

一次 error 是进程停止期间的预期断线；第二次 open 证明原生连接恢复。重复 sequence 1 来自按初始 URL 游标回放，Workbench 客户端按本地最新游标忽略；sequence 2 被连续接收。新增客户端测试验证两次 open 分别报告游标 1 和 2，供 App 把错误状态恢复为 connected。真正的 sequence gap 仍走关闭和显式回补路径。

## 最终门禁

- `bun run check`：通过
- `bun run test`：136 个测试通过
- `bun run build`：通过
- `bun install --frozen-lockfile`：无变更
- `bun run audit`：0 个生产依赖漏洞
- `git diff --check`：通过
