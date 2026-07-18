# MCP 审计 Task/Run 绑定结果

## 实现

- 审计 Schema 新增可选严格 context：Task ID、Run ID、绑定时间；旧未绑定文件仍可解析；
- 启用审计时条件注册 `bind_mcp_audit_context`，首次绑定持久化，相同 Task/Run 幂等，不同绑定返回稳定错误且被审计为 error；
- 绑定前 capability/list/claim 等调用仍可记录，所有完成调用属于同一个 MCP 会话；
- CodeArts Skill 要求 claim 后、replay/生产前经 `ask` 调用绑定；未配置审计不影响生产流程；
- benchmark 导入 audit 时强制 context 与 Relay 返回的 Task/Run 一致，并把绑定 ID、session ID 和内容 SHA-256写入 record。

- 真实 Node stdio MCP 列出并调用 `bind_mcp_audit_context`，随后调用 `get_gameforge_capabilities`；audit context 与 Relay 生成的 Task ID、`mcp-bound-real` Run ID 一致；
- 真实本地 Relay 完成 create→claim→verification→complete；`benchmark capture --mcp-audit` 交叉核验后生成 `record.json`；
- record 工具摘要为 2 次、两个唯一工具、0 errors，并保存同一 Task/Run、session ID 与 audit SHA-256；
- MCP server 40 项与 benchmark 8 项定向测试通过，覆盖幂等/冲突绑定、未绑定/错绑定/截断导入拒绝；
- 临时 8787 服务已关闭。

- `bun install --frozen-lockfile`：198 个安装、281 个包，无变更；
- `bun run check`：通过；
- `bun run test`：279 个测试通过；
- `bun run build` 与 `bun run bundle:check`：通过，Workbench 仍低于预算，保留已知 Phaser 异步 chunk 提示；
- MCP、Chrome、Desktop doctor 均 `ok: true`；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过。

## 边界

- 绑定证明此 MCP 会话声明服务于指定 Task/Run，并由 Relay 交叉核验 ID；它不替代客户端身份认证；
- Run Relay 当前仍是本地开发边界，不应直接暴露到不受信网络；
- 未绑定的历史 audit 可保留查看，但不能再传给 benchmark 作为归属证据。
