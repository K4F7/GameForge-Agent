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
