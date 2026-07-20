# MCP 工具调用审计结果

## 实现

- `GAMEFORGE_MCP_AUDIT_FILE` 可选启用单会话 JSON 审计；未配置时无任何审计写入；
- 统一包裹所有实际执行的 MCP tool callback，记录 invocation sequence、工具名、开始时间、整数耗时和 success/error；SDK 参数校验前被拒绝的请求不计为已执行工具；
- 不检查或记录 arguments、CallToolResult、provider error message、Prompt、URL、路径、密钥或 job handle；
- 绝对 `.json` 新路径、0600 文件、0700 新目录、4 MiB/10,000 调用上限、同步临时文件与原子 rename；审计失败写固定 stderr 警告但不改变工具结果；
- benchmark `--mcp-audit` 要求严格且未截断的审计，并要求人工 metadata 的 tools 保持 unknown，再计算 count、唯一 names、errors 与 audit SHA-256。

- `bun run doctor` 通过真实 Node stdio MCP 调用 `get_gameforge_capabilities`，生成 `mcp-audit.json`：1 次 success、未截断、无参数或结果；
- 真实本地 Relay 完成 create→claim→verification→complete，`benchmark capture --mcp-audit` 生成 `record.json`；
- record 的工具摘要为 count 1、`get_gameforge_capabilities`、errors 0，并保存 audit session ID 与内容 SHA-256，不再是 null；
- MCP server 6 个测试文件、40 个测试通过；benchmark 2 个测试文件、8 个测试通过；integrations 2 个测试文件、10 个测试通过；
- `GAMEFORGE_MCP_AUDIT_DIR` 已进入 CodeArts/OpenCode 动态运行配置，每次进程生成唯一文件；固定 FILE 仅保留给单次隔离实验；
- 临时 8787 服务已关闭。

- `bun install --frozen-lockfile`：198 个安装、281 个包，无变更；
- `bun run check`：通过；
- `bun run test`：279 个测试通过；
- `bun run build` 与 `bun run bundle:check`：通过，WorkBench 仍低于预算，保留已知 Phaser 异步 chunk 提示；
- MCP、Chrome、Desktop doctor 均 `ok: true`；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过。

## 边界

- 审计证明所选 MCP 进程观察到的已执行工具，不自动证明它属于某个 Task/Run；操作者必须选择正确会话文件并把它作为相对 evidence 保留；
- 进程崩溃时已完成且成功落盘的调用仍可解析，正在执行的调用不会伪造为完成；
- 达到上限会标记 truncated，benchmark 拒绝使用该文件。
