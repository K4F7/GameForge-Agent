# 结果

真实 CodeArts Agent 在约 39.3 秒内完成无 GUI Task 创建、认领和回放。最终状态：

| 证据 | 结果 |
|---|---|
| Task | `claimed`，`claimedBy: codearts`，language `zh-CN` |
| Run | `run-codearts-headless-20260718-1` |
| 回放 | 1 个事件：sequence 1 `run.started` |
| MCP 调用 | `create_game_task`、`claim_game_task`、`replay_game_run` 各 1 次 |
| MCP 错误 | 0 |
| GameForge 媒体 Provider | 0 次 |
| 仓库/项目文件修改 | Agent 工具 0 次；CodeArts 宿主初始化自动改写 1 个上下文文件，已恢复 |
| 视觉证据 | 无；本实验不是玩法、构建、DevTool 或真机验收 |

忽略目录中的 MCP Audit 会话记录 3 个连续成功调用，且只含工具名、时间、耗时和结果，不含参数或返回值。Relay 权威详情确认 Task ID、Run ID、认领者与语言一致；回放只有创建 Task 时原子产生的唯一 `run.started`。实验完成后关闭无持久化 Relay，因此该临时 Task 不进入生产状态。

CodeArts 宿主在初始化时自动删除了 `.codeartsdoer/AGENTS.md` 的稳定说明头并移除末尾换行；这不在 MCP Audit 中，也不是模型显式调用的编辑工具。实验后通过 Git diff 发现并恢复，计为 1 次人工干预。它说明真实客户端验收后仍必须检查工作树，不能只相信 Agent 最终文本中的“未修改文件”。

## 发现并修复的问题

1. CodeArts 26.6.2 严格拒绝 OpenCode-compatible MCP 对象中的非标准 `cwd`。启动器本来已经把客户端工作目录设为仓库根，因此删除该字段，并用测试锁定官方字段集合。
2. 未设置 `GAMEFORGE_RUN_RELAY_TOKEN` 时，配置引用会展开为空字符串；MCP 曾把空串当成已启用 token 并在启动前拒绝。现在动态启动器只在变量完全未设置时省略引用；显式空白会在写配置前 fail-closed，非空 token 必须通过 32–512 字符校验。所有消费者同样只把 `undefined` 视为关闭认证。
3. CodeArts 非交互 `run` 不复用 TUI OAuth，当前官方路径要求进程环境中的 CLI AK/SK。Windows 用户级变量已存在，但旧终端未继承；本实验从用户级环境只读注入当前子进程，没有输出值。

## 未成功尝试的边界

- 首次运行因 `cwd` 配置 Schema 错误在会话前退出。
- 配置修正后两次 180 秒会话中，CodeArts 模型请求返回成功，但 MCP 因空 token 启动失败，Relay Task 与 MCP Audit 均为空；没有把这些尝试记为 Agent/MCP 成功。
- 显式选择 `huaweicloud-maas/GLM-5.1`、修复 MCP 启动后，最终会话一次完成三个工具调用。

## 验证

- `bun install --frozen-lockfile`：无变更
- `bun run check`
- `bun run test`：358 项通过
- `bun run build`
- `bun run bundle:check`：游戏与 Workbench 均在预算内
- `bun run audit`：0 个已知漏洞
- `bun run doctor`：基础环境 `ok: true`
- 配置真实 loopback Relay 与受管输出根后再次 `bun run doctor`：`taskInbox: true`，`create_game_task` 在 22 个工具中，bounded 只读 Task 探针通过
- CodeArts JSON 事件：3 个目标工具均 `status: completed`
- Relay 权威读取：Task `claimed`、事件数 1、sequence 1
- `git diff --check`

官方依据（访问日期 2026-07-18）：

- 华为云 CodeArts CLI 授权文档：<https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0026.html>
- OpenCode 本地 MCP 配置：<https://opencode.ai/docs/mcp-servers/>
