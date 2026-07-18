# MCP 审计 Task/Run 绑定

让启用审计的 MCP 会话通过条件工具一次性绑定权威 Task/Run；重复相同绑定幂等，不同绑定拒绝。Benchmark 导入必须核对 audit context 与 Relay Task。

验收条件：真实生产 stdio MCP 完成 bind + capability 调用；审计包含匹配上下文和工具序列；真实 Relay record 导入成功；未绑定/错绑定被测试拒绝；整仓门禁通过。
