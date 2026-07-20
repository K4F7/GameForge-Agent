# 实验环境

- 日期：2026-07-17
- 时区：Asia/Shanghai
- 系统：Windows 11 专业版 10.0.26200
- PowerShell：5.1.26100.8737
- CLI A：0.144.4，来自本机 npm 安装
- CLI B：0.144.5，来自 Codex 桌面运行时
- Provider：`codex_local_access`
- API：本机 Responses 兼容服务，地址已脱敏为 `localhost`
- 模型：`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`
- 当前模型目录：`cockpit-local-access-model-catalog.json`，2026-07-17 03:00:48 更新，`comp_hash=3000`
- 历史成功 rollout：`comp_hash=2911`
- 当前持久配置：`supports_websockets=false`、`multi_agent_v2.enabled=true`
- 测试覆盖参数：`supports_websockets=true/false`、`non_code_mode_only=false`、`tool_namespace=agents/collaboration`
- 密钥使用：未读取、未记录、未提交任何凭据值
- 用户人工干预：2 次，分别将模型范围收敛为 sol/terra/luna，以及提出版本与 WebSocket 假设
- 测试脚本修正：参数位置、stdin 引号、绝对模型目录路径等包装问题均单独记录为测试工具问题，不计为模型结果

## 官方资料

- Codex Manual，Subagents，访问日期 2026-07-17：<https://learn.chatgpt.com/docs/agent-configuration/subagents.md>
- 手册说明当前本地 Codex 默认支持子代理工作流；子代理活动应出现在桌面端、CLI 和 IDE 中。
