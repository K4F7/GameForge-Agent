# GameForge Agent 分层架构

更新日期：2026-07-23

## 四个稳定层次

| 层 | 位置 | 职责 | 禁止事项 |
|---|---|---|---|
| 规则 | `AGENTS.md`、`.codeartsdoer/AGENTS.md` | 工程、安全和客户端行为约束 | 密钥、本机路径、动态会话状态 |
| 生产流程 | `.codeartsdoer/skills/` | CodeArts 按需加载的步骤、恢复规则与验收条件 | Provider 实现、Agent 内嵌循环 |
| 确定性工具 | `packages/mcp-server/` 及核心 packages | Schema、生成、资产、预览、验证、Relay 协调 | 需求理解、自动规划和自主重试循环 |
| 外置 UI 验收 | `packages/ui-test-harness/` | 驱动相互独立的原版 CodeArts TUI 与原版 OpenChamber GUI | 提供产品 UI；改造被测界面；恢复已废弃的 `apps/tui/`、`apps/workbench/` 或 `apps/desktop/` |

`packages/opencode-plugin/` 和 `integrations/` 位于核心之外：它们只负责宿主适配、状态提示和启动配置。删除这些适配层后，MCP、Relay、生成器和浏览器验收仍应独立可用。

## 产品化目标边界

仓库当前不提供自建产品 TUI、Workbench 或桌面壳。CodeArts/OpenCode 宿主适配与 `packages/ui-test-harness/` 外置验收层和本地后端保持单仓、多制品边界，并共享 `packages/contracts/` 的版本化公开协议。原版 CodeArts TUI 与原版 OpenChamber GUI 只要求 Task、Run、MCP Audit 和证据关联等业务语义一致，不要求镜像交互或界面。

本地后端是唯一状态权威，负责 Task/Run、并发控制、MCP Audit 和事件发布。CLI 与 GUI 通过公开协议自动发现或拉起后端；同一 Task 的竞争状态变更由后端拒绝其中一个并返回可解释的冲突结果。后端应在有限兼容窗口内支持当前与上一稳定客户端契约版本。

当前质量门的公开入口是根级 `verify:backend`、`verify:cli`、`verify:gui`、`verify:compat` 与聚合命令 `verify`。`verify:cli` 覆盖 CodeArts/OpenCode 启动适配，`verify:gui` 覆盖外置 UI harness 的构建、类型、依赖准入与测试，`verify:compat` 执行 MCP 工作流集成测试；真实 CodeArts/OpenChamber 可见验收仍需显式运行并记录证据。

## 为什么核心不是 OpenCode Plugin

OpenCode Plugin 生命周期依附具体客户端版本、Session 和 TUI API。GameForge 的长期状态则属于 Task、RunEvent、Manifest 和生成项目。把核心放入 Plugin 会导致：

- CodeArts、OpenCode 和其他 MCP 客户端无法共享相同确定性工具；
- Session idle 被误当成 Run completed；
- 插件升级影响资产和生成协议；
- headless/CI 无法复用核心。

因此 Plugin 只能调用公开 Relay/MCP 边界，不能成为状态源或业务实现。

## MCP 权限建议

OpenCode 会把 MCP 工具暴露为带服务器前缀的名称，例如 `gameforge_<tool>`。实际名称以客户端工具列表为准。

- `allow`：`validate_*`、`get_*`、`list_*`、`replay_*`、`query_*` 等无写入校验与查询；
- `ask`：`generate_*`、`import_*`、`request_*`、`recover_*`、`start_*`、`stop_*`、`create_*`、`claim_*`、`publish_*`、`complete_*`；
- 未匹配的 `gameforge_*` 默认 `ask`。

OpenCode 权限按最后匹配规则覆盖前项，因此 `opencode.json.example` 先声明通配 `ask`，再用更具体规则放行查询类工具。涉及云请求的 `search_*`/`draft_*` 即使只返回数据也建议保持 `ask`，因为可能消耗配额或产生外部调用。

`create_game_task` 会新增本地 Task/Run，因此仍属于 `ask`。它通过 MCP annotations 声明非破坏性、相同参数幂等和封闭域交互，只帮助支持 annotations 的客户端展示风险；这些提示不是权限授予，也不能覆盖宿主配置或用户确认。

## CodeArts 自动文件策略

- `.codeartsdoer/AGENTS.md`：纳入版本管理，但只保存稳定、脱敏、跨机器的工程上下文；根 `AGENTS.md` 仍是权威规则。
- `.codeartsdoer/skills/ProjectSkillStatus.txt`：CodeArts 动态本地状态，加入 `.codeartsdoer/.gitignore`。
- `.codeartsdoer/skills/ProjectSkillStatus.example.txt`：可提交模板，只列稳定 Skill 名称，不记录本机时间、会话或账号。
