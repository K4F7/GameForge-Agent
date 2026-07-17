# CodeArts Agent 与 OpenCode 官方资料研判

访问日期：2026-07-18

## 结论

CodeArts Agent 与 OpenCode 在 TUI/CLI、client/server、Agent、Rules、Skills、MCP 和多会话等方面存在值得继续核验的结构相似性。用户在已安装客户端上的观察是“CodeArts 基于 OpenCode 修改”，本仓库将其作为兼容性研究线索，不把相似性本身写成已由官方证明的派生关系。涉及 CodeArts 行为时，以当前安装版本的真实运行证据和华为云官方文档为准。

## CodeArts 官方能力

- CodeArts 提供 IDE、VS Code/JetBrains 插件、Agent Space 与 CLI/TUI 等使用形态；Agent Space 支持智能体和 AgentTeam。[产品介绍](https://support.huaweicloud.com/productdesc-codeartssnap/codeartsdoer_pd_0001.html)、[功能介绍](https://support.huaweicloud.com/productdesc-codeartssnap/codeartsdoer_pd_0004.html)
- CLI 支持 `codearts [project]` 启动 TUI，以及 `codearts run`、`codearts mcp`、`codearts agent`、`codearts models`、session/export 等命令。[CLI 命令参考](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0034.html)
- CodeArts 兼容项目根目录 `AGENTS.md`；项目级规则优先于个人级规则。项目本地 Agent 位于 `.codeartsdoer/agents/`。[IDE 用户指南 PDF](https://support.huaweicloud.com/usermanual-codeartssnap/%E5%8D%8E%E4%B8%BA%E4%BA%91%E7%A0%81%E9%81%93%EF%BC%88CodeArts%EF%BC%89%E4%BB%A3%E7%A0%81%E6%99%BA%E8%83%BD%E4%BD%93%20%E7%94%A8%E6%88%B7%E6%8C%87%E5%8D%97%EF%BC%88IDE%EF%BC%89-pdf.pdf)
- 官方 MCP 页面明确支持两类服务器：本地 stdio，以及使用 SSE 或 Streamable HTTP 的 HTTP 服务。stdio 配置要求 `command`，可选 `args` 和 `env`；这与本仓库 `node + dist/index.js` 的生产配置一致。[MCP 用户指南](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)
- 官方区分 Rule、Skill 和 MCP：Rule 在会话开始加载并持续参与推理，Skill 按需加载，MCP 按需调用外部接口而不持续参与推理。该边界支持本仓库“CodeArts 为主智能体、MCP 只提供确定性工具”的设计。[MCP 用户指南](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)
- AgentTeam 采用 Leader 编排和 Teammate 执行，支持独立上下文、成员通信和共享任务池，仅在 Agent Space 中提供。[内置智能体](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsagent_ug_0052.html)、[多任务并行](https://support.huaweicloud.com/usermanual-space/codeartsagent_space_0003.html)

Windows 实验需要记录系统版本、代理环境变量以及旧版 `codearts`/`codearts.cmd` 的 PATH 冲突。安装成功仍不等于完成真实 Task、MCP 和 RunEvent 闭环。[快速启动](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0002.html)、[CLI 命令冲突 FAQ](https://support.huaweicloud.com/codeartssnap_faq/codeartsagent_faq_0018.html)

## OpenCode 官方架构

- OpenCode 是开源编码 Agent，提供 TUI、CLI 和桌面客户端；TUI 是本地 Server 的客户端，`opencode serve` 可独立启动 HTTP/OpenAPI 服务。[官方仓库](https://github.com/anomalyco/opencode)、[Server 文档](https://opencode.ai/docs/server/)
- 配置使用 `opencode.json/jsonc`、项目 `.opencode/` 与全局 `~/.config/opencode/`，包含 agent、permission、tools、provider、model、mcp、plugin 和 instructions 等字段。[配置文档](https://opencode.ai/docs/config/)
- OpenCode 使用 `AGENTS.md`，同时兼容部分 Claude 路径；Agents 可以由 Markdown 定义并覆盖工具权限。[Rules 文档](https://dev.opencode.ai/docs/rules/)、[Agents 文档](https://opencode.ai/docs/agents/)
- Skills 可从 `.opencode/skills/`、`.agents/skills/`、`.claude/skills/` 及对应全局目录发现，通过原生 `skill` 工具按需加载，并受 allow/deny/ask 权限控制。[Skills 文档](https://opencode.ai/docs/skills/)
- 插件是 JavaScript/TypeScript 模块；npm 插件和项目插件依赖由 Bun 安装和缓存。OpenCode 官方仓库也采用 TypeScript 与 Bun。[Plugins 文档](https://opencode.ai/docs/plugins/)、[官方仓库](https://github.com/anomalyco/opencode)
- Provider 层使用 Vercel AI SDK 与 Models.dev，支持官方或自定义 OpenAI-compatible Provider；凭据与配置分离。[Providers 文档](https://opencode.ai/docs/providers/)

## 本机指纹核验清单

以下项目只用于验证兼容性或派生线索，不读取 Token、账号隐私或完整私人会话：

1. 记录 CodeArts 客户端版本、可执行文件名、`codearts --help` 和子命令列表；
2. 检查是否存在改名后的 client/server、本地监听端口或 OpenAPI 路由；
3. 比较 Agent、Rule、Skill、MCP 与 permission 配置 Schema，不复制用户凭据；
4. 检查 `.codeartsdoer/` 与 OpenCode `.opencode/` 的目录和 Markdown frontmatter 是否同构；
5. 比较 `/init`、会话导出、模型连接、MCP 管理和多 Agent 命令行为；
6. 若安装文件包含许可证、版本元数据或上游版权声明，只记录文件名、版本和必要短摘要；
7. 把每一项标记为“相同”“CodeArts 改名/扩展”“不同”或“证据不足”。

即使多个指纹吻合，也只说明实现兼容或存在派生可能。除非安装包许可证、源码、官方声明或可验证版本元数据明确给出来源，不写成确定事实。

## 2026-07-18 本机证据

- CLI 入口为 `%USERPROFILE%\.codeartsdoer\installers\codearts.cmd`，实际可执行文件在 `installers\bin\codearts.exe`；`--version` 输出 26.6.2。
- shim 设置 `KERNEL_DATA_DIR=%USERPROFILE%\.codeartsdoer\cli-data`、`KERNEL_CONFIG_DIR=%USERPROFILE%\.codeartsdoer`、`OPENCODE_CONFIG=%USERPROFILE%\.codeartsdoer\codearts_cli.json`、`OPENCODE_MODE=tui` 和 `SCENARIO=codeartsdoer`。
- 安装包的 `package.json` 依赖 `@opencode-ai/plugin` 26.6.2；`codearts_cli.json` 使用 `https://opencode.ai/config.json` Schema。
- CLI 暴露 `run`、`serve`、`mcp`、`agent`、`models`、session/export 等与 OpenCode 同族的命令。

这些本机文件与环境变量是直接实现指纹，比 UI 相似性更强；但仓库仍将“基于 OpenCode 修改”标为用户观察与本机证据支持的结论，而不是华为云官方声明。探测没有读取 auth、permission 内容、Token 或私人会话。

## 对 GameForge Agent 的影响

- 保持官方 stdio MCP 配置；CodeArts 启动 Node MCP，Bun 继续负责依赖、workspace、检查、测试和构建。
- 项目规则继续放在根 `AGENTS.md`，CodeArts 专用 Skills/Agents 放在 `.codeartsdoer/`。
- 第二轮 TUI 优先复用 GameForge 自己的 Relay/RunEvent 协议，不依赖 OpenCode 私有 Session API，避免绑定未证实的内部实现。
- 如果后续找到 CodeArts 本地 Server/API，只作为可选适配器，不改变“CodeArts 主智能体、MCP 确定性”的架构边界。
