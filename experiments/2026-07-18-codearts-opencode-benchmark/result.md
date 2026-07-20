# CodeArts 与 OpenCode 同任务基准结果

## CodeArts

- Task：`task-328ebb24-2352-4810-a994-1ca3acf2da65`；
- Run：`codearts-real-20260718-0145`；
- 结果：completed；
- 事件：6 条，包含 capabilities、spec、verification、preview、completed；
- Chrome：won、score 2、lives 3、零诊断错误；
- 人工干预：启动 OAuth TUI、粘贴初始提示、一次继续提示；
- 详细证据：`../2026-07-18-codearts-real-e2e/result.md`。

## OpenCode

- Task：`task-48c149eb-17f3-4681-a096-57b21262cee7`；
- Run：`opencode-real-20260718-0240`；
- 模型：`opencode/deepseek-v4-flash-free`；
- OpenCode 成功创建 session 并选择 build agent，但模型首个 stream 在约 1.1 秒后返回 `Rate limit exceeded`；
- 运行约 3 分钟没有产生模型输出或 MCP 调用，Task 始终 queued，Run 只有 `run.started`；
- 主代理终止本次启动的两个 OpenCode 进程，并通过 TUI 显式停止 Run，最终 sequence 2 `run.stopped`；
- 人工干预：0（非交互运行）；
- 结果：因免费模型限流未完成，不能与 CodeArts 成功结果做质量/工具数量比较。

## 比较结论

当前证据只证明两种客户端都能加载同一动态配置，不能证明 OpenCode 完成了 GameForge 工作流。CodeArts 的真实闭环已通过；OpenCode 在调用任何 MCP 工具前被模型服务限流。后续应在 OpenCode 配置稳定可用的国产模型 Provider 后，复用同一个 stopped Task 的新 Run 或创建全新 Run 重测，不覆盖本次失败记录。

## 机器可读证据

- `definition.json`：规范化输入与目标；
- `codearts.record.json`、`opencode.record.json`：经 Zod 校验的脱敏记录；
- `comparison.generated.md`：由 CLI 生成，不手工修改。

生成命令：

```powershell
bun run benchmark -- report experiments/2026-07-18-codearts-opencode-benchmark/definition.json experiments/2026-07-18-codearts-opencode-benchmark/codearts.record.json experiments/2026-07-18-codearts-opencode-benchmark/opencode.record.json --out experiments/2026-07-18-codearts-opencode-benchmark/comparison.generated.md
```

两份记录的 `definitionFingerprint` 相同，因此证明任务定义等价；Task/Run ID 不同是隔离执行的预期行为。自动报告明确给出“工作流质量不可比较”，不会把 OpenCode 的模型限流归因成客户端质量结论。CodeArts 的历史记录未保存完整 MCP 工具调用序列，因此工具数量使用 `null`/`unknown`，不从事件数反推或伪造。

本次机器化改造验证：`bun install --frozen-lockfile` 无变更，`bun run check`、`bun run build`、`bun run doctor` 全部通过，整仓 201 项测试通过，`bun run audit` 为 0 vulnerabilities，`git diff --check` 通过。第一次报告命令因 workspace filter 将相对路径解析到包目录而失败，根脚本随后改为从仓库根直接启动 CLI；该失败未被记录为成功结果。
