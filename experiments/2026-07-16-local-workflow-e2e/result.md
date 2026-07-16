# 本地工作流端到端结果

## 最终结果

通过。真实链路依次产生：

```text
queued Task + run.started
→ claimed
→ replay(after=0)
→ get_gameforge_capabilities
→ capabilities.ready
→ spec.ready
→ generator dry-run
→ generator apply
→ request_image_asset
→ ProjectAssetStore 落盘 + Manifest revision 1
→ asset.ready
→ import_sound_asset + Manifest revision 2
→ asset.ready
→ submit_voice_job
→ voice.job.updated(processing)
→ query_voice_job
→ voice.job.updated(succeeded)
→ materialize_voice_job
→ Manifest revision 3
→ asset.ready
→ managed Vite preview (HTTP 200)
→ preview.ready
→ verify_game_project
→ verification.ready
→ run.completed
→ Task completed
```

最终 Run 回放事件类型严格为：

```json
["run.started", "capabilities.ready", "spec.ready", "asset.ready", "asset.ready", "voice.job.updated", "voice.job.updated", "asset.ready", "preview.ready", "verification.ready", "run.completed"]
```

目标测试命令：

```text
bun run --filter @gameforge/mcp-server test
```

当前目标结果：3 个测试文件、23 个测试通过。预览由受控 loopback Vite 会话提供，并在测试结束后关闭；临时生成项目已清理。

随后于约 21:20 执行完整门禁：`bun run check`、`bun run test`（130 个测试）、`bun run build`、`bun install --frozen-lockfile`、`bun run audit`（0 个生产依赖漏洞）和 `git diff --check` 均通过。Phaser 主包仍产生已知的 500 kB chunk 警告，不是构建失败。

加入 Asset Store 路径后于约 21:23 再次执行门禁。第一次整仓测试中 `game-verifier/src/preview.test.ts` 在导入阶段出现一次 `SyntaxError: Invalid or unexpected token`；同轮新增 MCP 集成测试通过。检查源文件字节与 UTF-8 内容未发现异常，随即单独复跑 verifier 为 10/10，通过后再次整仓复跑为 130/130。其余检查、构建、冻结锁安装、0 漏洞审计和 diff 检查均通过。该不可复现的并行导入瞬态被保留为证据，未将首次失败冒充为通过。

加入音效和 TTS 路径后于约 21:27 再次执行完整门禁：严格检查、130 个测试、构建、冻结锁安装、0 漏洞审计和 diff 检查全部一次通过。

## 证明范围

- 证明 Workbench 等价任务输入可以通过真实 Relay 交给 MCP 客户端；
- 证明 CodeArts 所需的认领、游标恢复、事件发布、项目生成、预览和终态工具可以按同一 Run 连续组合；
- 证明测试图片、CC0 音效和配音分别经过生产 Asset Store 的魔数、哈希、角色、来源/许可与 Manifest 校验后真实落盘，并以三个连续 `asset.ready` 从 Relay 完整回放；
- 证明 TTS submit/query/materialize 保持三个确定性调用，MCP 不进行轮询；
- 证明 `spec.ready`、`asset.ready` 与 `preview.ready` 可供 Workbench 消费；
- 证明该组合不需要云密钥，也没有在 MCP 内实现 Agent 循环。

## 尚未证明

- 真实 CodeArts IDE/CLI 是否会正确执行 Skill；
- 百炼 Qwen、Seedream、火山 TTS、Freesound 的账号级调用；
- Seedream、Freesound 和火山 TTS 真实云响应进入 `asset.ready` 的账号级端到端路径；本实验只证明 Provider 之后的生产落盘与事件链路；
- 真实 Chrome 的 won/lost 玩法验收（另有 telemetry 实验已证明本地 won）；
- Workbench 浏览器页面在此实验中的人工点击与视觉检查。
