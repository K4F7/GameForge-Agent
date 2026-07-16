# 环境与来源

- 日期：2026-07-16
- 时区：Asia/Shanghai
- Bun：1.3.14
- Node：24.18.0（stdio MCP 与 Playwright 的正式运行时）
- Workbench：Vite 8.1.4，端口 4173
- 示例游戏：Vite 8.1.4，端口 5173
- Run Relay：Node HTTP，端口 8787
- MCP SDK：1.29.0
- 云模型调用：0
- 密钥：未使用
- 人工干预：2 次诊断修正，均记录在结果中

## 官方依据

- 华为云码道 MCP 用户指南：<https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html>
- 访问日期：2026-07-16
- 采用的官方字段：`mcpServers`、`command`、`args`、`env`
- 官方约束：`command` 必填；`env` 值必须为字符串；配置或环境变量变更后重启 MCP。
