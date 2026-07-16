# TTS 作业中断恢复结果

## 已验证流程

```text
Client A claim Task
→ submit_voice_job
→ publish voice.job.updated(processing, signed handle)
→ Client A/MCP Server A 结束
→ Client B replay_game_run(after=0)
→ 从最新 projectId + assetId 事件恢复 signed handle
→ query_voice_job 一次
→ succeeded
```

契约测试同时拒绝非签名 handle。Workbench 的归约状态只包含 projectId、assetId 和 status，序列化结果不包含 handle；生产 UI 仅显示资产 ID 和异步状态。Relay 持久化测试覆盖该事件写入快照和重启恢复。

## 验证命令与最终结果

目标包测试：contracts 32、providers 22、Workbench 20、MCP Server 23、Run Relay 26，全部通过。

- `bun run check`：通过；
- `bun run test`：143 个测试通过，`apps/game` 无测试文件并按既有 `--passWithNoTests` 配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 仍有已知的 500 kB 警告，不是构建失败；
- `bun install --frozen-lockfile`：检查 171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过；
- 端口 4173、5173、8787：无残留监听。

整仓 check、test、build 于约 22:44 执行；冻结安装、审计、diff 和端口检查随后完成。

## 剩余边界

- 未在真实 CodeArts IDE/CLI 中执行 Skill；
- 未调用真实火山语音账号，不能证明账号许可、音色质量、延迟或下载主机配置；
- 失败状态保留证据但不自动重提，是否重试由主智能体基于任务上下文决定。
