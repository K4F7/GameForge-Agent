# 环境

- 日期：2026-07-18
- 系统：Windows，PowerShell
- CodeArts：26.6.2，非交互 `run --format json`
- CodeArts 内置模型：`huaweicloud-maas/GLM-5.1`
- 认证：Windows 用户级 `CODEARTS_CLI_AK`/`CODEARTS_CLI_SK` 仅注入子进程；实验未读取、打印或写入值
- MCP：本地 stdio，Node 启动 `packages/mcp-server/dist/index.js`
- Relay：loopback HTTP `127.0.0.1:8787`，无认证、无持久化
- Task/Run：`task-0b9a15f7-34ad-476b-a152-3377574935ea` / `run-codearts-headless-20260718-1`
- 媒体 Provider：0 次

当前账号通过 `codearts models` 实际列出的精确 target 为 `huaweicloud-maas/deepseek-v3.2`、`huaweicloud-maas/GLM-4.7-SFT-Harmony`、`huaweicloud-maas/Glm-5-internal` 和 `huaweicloud-maas/GLM-5.1`；本实验显式选择 GLM-5.1，不从仓库静态配置猜测可用模型。

非交互客户端无法呈现 `ask` 确认，因此只在被忽略的单次实验配置中精确放行 `gameforge_create_game_task` 与 `gameforge_claim_game_task`；查询类 replay 已按默认策略放行。可提交的生产模板仍保持 `create_*`/`claim_*: ask`。
