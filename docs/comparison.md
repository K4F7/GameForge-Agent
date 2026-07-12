# CodeArts Agent、Claude Code 与 Codex 对比

更新日期：2026-07-13

## 核心结论

三者都是仓库级代码智能体，而不是传统的单文件代码补全工具。它们的共同核心是：理解项目上下文、规划任务、调用工具、跨文件修改、运行命令，并根据测试结果继续修复。

| 维度 | CodeArts Agent | Claude Code | OpenAI Codex |
|---|---|---|---|
| 主要入口 | CodeArts IDE、IDE插件、CLI/TUI、Agent Space | CLI、IDE、桌面端、Web | CLI、IDE、Codex应用、云端任务 |
| 项目规则 | `AGENTS.md`、项目/团队/企业规则 | `CLAUDE.md`、`.claude/rules/` | `AGENTS.md` |
| 可复用流程 | `.codeartsdoer/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` | Skills / `SKILL.md` |
| 外部工具 | MCP（stdio、SSE、Streamable HTTP） | MCP | MCP、应用连接器 |
| 多智能体 | Agent Team：Leader + Teammates | Subagents、Agent Teams/SDK能力 | 子智能体、并行云任务等形态 |
| 自动约束 | Rules、权限和沙箱设置 | Permissions、hooks、settings | 沙箱、审批、hooks及项目配置 |
| 代码库理解 | 本地/云端代码库索引 | 仓库搜索、工具与上下文管理 | 仓库搜索、工具与上下文管理 |
| 平台特点 | 华为云研发体系、技能与规则中心、Agent Team可视化 | 终端生态成熟，hooks和扩展体系细致 | 本地与云端协作、OpenAI工具与连接器生态 |

## 概念映射

| 工程意图 | CodeArts Agent | Claude Code | Codex |
|---|---|---|---|
| 每次会话都遵守的仓库规范 | `AGENTS.md` / Rule | `CLAUDE.md` / rules | `AGENTS.md` |
| 按需加载的专项工作流 | Skill | Skill | Skill |
| 连接浏览器、数据库、GitHub等 | MCP | MCP | MCP / Connector |
| 隔离专项任务上下文 | Teammate/Subagent | Subagent | Subagent |
| 在工具调用前后强制检查 | 产品安全策略/规则 | Hooks | Hooks/审批策略 |

## 关键差异

### CodeArts Agent

- 同时提供IDE、CLI/TUI和Agent Space。
- Rules、Skills、MCP、自定义智能体和代码库索引被统一放进产品界面管理。
- Agent Team采用Leader编排和Teammate执行，适合展示任务拆解和团队协同过程。
- 支持本地项目级以及云端个人、团队、企业级技能和规则。

### Claude Code

- 核心体验偏终端，Agent循环明确分为收集上下文、行动和验证。
- `CLAUDE.md`、Skills、Subagents、Hooks、MCP和Plugins组成较完整的扩展层。
- Hooks适合在生命周期节点执行确定性检查；Agent SDK便于把同一套循环嵌入应用。

### Codex

- 与CodeArts一样识别`AGENTS.md`作为持久仓库指导。
- 支持本地CLI/IDE工作及云端委派、并行和代码审查场景。
- 可配置MCP，也可将Codex CLI本身作为MCP服务器供其他Agent调用。

## 对本项目的启示

为避免绑定单一工具，稳定的工程知识放在`AGENTS.md`和普通文档中；CodeArts专属流程放入`.codeartsdoer/skills/`。后续如果需要跨工具测试，再为Claude Code和Codex添加薄适配层，不复制业务规则。

## 官方参考

- [CodeArts Agent CLI](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0001.html)
- [CodeArts Rules](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0019.html)
- [CodeArts Skills](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0024.html)
- [CodeArts MCP](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)
- [Claude Code工作原理](https://code.claude.com/docs/en/how-claude-code-works)
- [Claude Code扩展能力](https://code.claude.com/docs/en/features-overview)
- [Codex CLI功能](https://developers.openai.com/codex/cli/features)
- [将Codex作为MCP服务器](https://developers.openai.com/codex/guides/agents-sdk)

