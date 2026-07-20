# Benchmark 证据捕获结果

## 实现

- `benchmark capture` 使用严格定义和人工 metadata，从 Relay 获取 Task 并按 1000 项分页回放；
- 要求事件从 sequence 1 `run.started` 开始且连续、同 Run，并核验 completed/stopped/failed/nonterminal 状态；
- Prompt 与语言必须与定义完全一致，避免把错误 Run 绑定到 definition fingerprint；
- 仅输出事件类型计数、终态、耗时、验收摘要、工具摘要、人工干预和相对证据路径；
- 工具调用与人工信息只能来自 metadata，不从事件推断；输出使用 `wx`，拒绝覆盖已有证据。

## 初步验证

- 2 个 benchmark 测试文件、7 个测试通过；
- 1001 个事件 fixture 触发两页读取，并验证含密钥/绝对路径的日志正文不进入 record；
- 定义不匹配与 completed 缺失 verification 均被拒绝；
- benchmark TypeScript 严格检查通过。
- 真实本地 Relay 完成 create→claim→verification→complete，CLI 生成 `record.json`；输出为 3 个事件摘要、passed/won 验收、null 工具历史和两个相对证据路径，不含 Prompt 或事件正文；
- capture metadata 会拒绝凭据赋值片段、URL、绝对路径和非标工具名，而不是做可能误导的有损替换；
- 临时 8787 服务已关闭。

- `bun install --frozen-lockfile`：198 个安装、281 个包，无变更；
- `bun run check`：通过；
- `bun run test`：274 个测试通过；
- `bun run build` 与 `bun run bundle:check`：通过，保留已知 Phaser 异步 chunk 大于 500 kB 提示；
- MCP、Chrome、Desktop doctor 均 `ok: true`；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过。

## 边界

- 超出 Relay 保留窗口时由 410 明确失败，不生成不完整 record；
- 旧 CodeArts 实验缺失的工具序列仍只能如实记录为 null，不能事后重建；
- metadata 由操作者负责核验，命令不访问 CodeArts 私有会话或 OAuth 状态。
