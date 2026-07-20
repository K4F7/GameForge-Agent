# CodeArts 已认领任务恢复结果

## 流程

```text
Workbench 创建 Task/Run
→ MCP Client A 以 codearts 认领
→ 发布 phase.completed(spec), sequence 2
→ submit_voice_job
→ 发布 voice.job.updated(processing), sequence 3
→ 关闭 Client A 和 MCP Server A
→ 启动全新 Client B 和 MCP Server B
→ list_game_tasks({limit: 20})
→ 找到 claimedBy=codearts
→ claim_game_task 幂等成功
→ replay_game_run(after=0)
→ 恢复 run.started + phase.completed(spec) + 签名 TTS job handle
→ 使用恢复的 handle 单次 query_voice_job，得到 succeeded
→ complete_game_run
→ Task completed
```

目标结果：MCP Server 3 个测试文件、23 个测试通过。

## 证明范围

- 证明 CodeArts 客户端/MCP 会话中断后可恢复已认领任务；
- 证明一次无过滤快照足够发现 claimed 与 queued，不需要轮询；
- 证明相同 agent 认领和 Run 回放可组合恢复游标；
- 证明 submit 后中断的异步 TTS 可从结构化 RunEvent 恢复签名 job handle，并在新会话中继续单次查询；
- 与 Relay 持久化的真实进程重启实验组合，可覆盖两侧分别重启。

## 剩余边界

- 尚未在真实 CodeArts IDE/CLI 中执行 Skill；
- 本实验不证明云 Provider 账号可用。

## 最终门禁

- `bun run check`：通过
- `bun run test`：143 个测试通过
- `bun run build`：通过
- `bun install --frozen-lockfile`：无变更
- `bun run audit`：0 个生产依赖漏洞
- `git diff --check`：通过
