# OpenCode 观察器交接文档

日期：2026-07-23

## 当前结论

下一阶段优先实现 OpenCode 官方观察器，不先做 Codex 协议对齐。选型原则已经写入根目录 `AGENTS.md` 和 `docs/decisions/0003-opencode-first-observer-stack.md`：

`OpenCode 官方库/协议 > 成熟第三方库 > 最薄适配代码 > 自研基础设施`

## 已完成

- 真实 CodeArts ConPTY、Relay Authority、MCP Audit、VT 和 headless 最小闭环已通过。
- 修复了 MCP 子进程继承残留火山语音 Token 导致启动崩溃的问题。
- 已确认 OpenCode 上游存在 Session/Message/Part/Event、Event Bus、SSE 和 SDK AsyncIterable 观察能力。
- Codex 对齐已明确移出当前范围。
- Codex 专属 `domain-modeling` 技能已安装到 `C:\Users\sern\.codex\skills\domain-modeling`，并通过 `quick_validate.py`；未修改 `.codeartsdoer`。
- 已以锁定的官方 `@opencode-ai/sdk@1.18.3` 实现只读 `/global/event` Observer，保存原始 payload、`type/properties`、可用时的 SSE `id:`，并提供独立 Evidence `sequence/after` 游标。
- Observer 测试覆盖顺序、`after`、重连重复 ID 去重和损坏序列拒绝；OpenCode 启动器默认使用独立 `XDG_DATA_HOME`。
- 真实探针确认 OpenCode 1.18.4 与 CodeArts 26.6.2 均暴露 `/global/event` 和 `/event`（200 持续 SSE）；尚未证明 CodeArts 的完整事件 schema/ID 与 OpenCode 相同。详见 `experiments/2026-07-23-opencode-observer-probe/result.md`。

## 下一步顺序

1. 在真实 Task 会话中连接 Observer，核验 OpenCode 与 CodeArts 的业务事件 payload、SSE `id:`、重连行为及 `sessionId`/`runId` 关联。
2. 使用 Playwright 官方 API 实现 OpenChamber headed/headless 驱动，采用加载完成、交互前、交互后、成功、失败五类关键截图。
3. 使用成熟 xterm.js 方案渲染同一 ConPTY VT 流；禁止另起第二个 Agent 会话。
4. 将真实原生事件与 GameForge Authority/Evidence sidecar 通过 `sessionId`、`runId` 关联。

## 当前约束

- 不录制视频；只保存关键节点截图。
- 不把截图、浏览器状态或 Authority 门禁伪装成 OpenCode Part。
- Relay API 暂不替换；第三方队列/持久化只在有明确扩展需求时评估。
- 不提交任何 API key、Token、认证数据库或本地实验目录。

## 验证入口

- `bun run build`
- `bun run --filter @gameforge/ui-test-harness test`
- `bun run --filter @gameforge/integrations test`
- `bun run codearts --dry-run`
- 新增 OpenCode Observer 后，必须增加真实 SDK/SSE 探针和脱敏实验结果。

## 交接时必须回答

- 当前 OpenCode CLI/SDK 版本和官方事件接口是否真实可用？
- CodeArts 是否提供同一接口，还是只能经 MCP Audit/Relay/VT 观察？
- 哪些组件使用官方库，哪些使用第三方库，哪些只剩薄适配？
- 每个关键截图、原始事件和 Authority 结果是否能通过 `sessionId`/`runId` 复核？
