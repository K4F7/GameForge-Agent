# 项目级 Agent 行为准则

## 项目目标

本仓库用于研究和验证 CodeArts Agent 的复杂软件工程能力。所有改动应具有明确需求、可复现步骤和可验证结果。

## CodeArts 客户端基线

- 当前研究环境已经安装 CodeArts Agent 客户端；后续实验应优先使用该真实客户端完成任务认领、MCP 调用和结果验收，不再把“尚未安装”作为默认前提。
- 当前观察表明 CodeArts Agent 是基于 OpenCode 修改的客户端。涉及配置目录、会话格式、工具协议或其他实现细节时，可以把 OpenCode 作为代码阅读与兼容性研究线索，但不得仅凭上游行为推断 CodeArts 行为；最终结论仍须以当前安装版本的实际运行证据或华为云官方文档为准。
- CodeArts 与独立 OpenCode CLI 必须使用不同的数据目录。仓库内实验优先通过 `bun run codearts` / `bun run opencode` 启动；不得让不同迁移版本共同写 `%USERPROFILE%\.local\share\opencode\opencode.db`。认证文件、数据库及其备份都属于用户私有状态，不纳入仓库。
- “已安装”不等于“端到端已验证”。只有真实 CodeArts 会话完成 Task 认领、确定性 MCP 工具调用、RunEvent 发布与 Workbench/浏览器验收后，才能记录为 CodeArts 集成通过。
- 当前默认 Agent 路由只使用 CodeArts 内置且由 `codearts models` 实际列出的 DeepSeek/GLM target。OpenCode、Hy3、Kimi 或其他跨宿主模型只保留历史研究能力；没有用户新的明确授权，不得放入默认 fallback。
- 百炼、Seedream、豆包语音、Freesound 与 MiniMax 适配器可保留，但当前不配置、不调用外部账号，生成游戏使用程序化/静音回退。

## 工作方式

1. 修改前先阅读相关代码、文档和现有约束。
2. 开发新功能前，先调研官方方案和成熟的第三方库；在满足需求、安全边界、许可证和维护性要求时优先复用，不重复造轮子。若选择自研，必须说明现有方案不适用的原因。
3. 复杂任务先给出简短计划和验收条件，再开始修改。
4. 优先进行小范围、可回滚的改动，避免无关重构。
5. 不得声称测试通过，除非已经实际运行对应命令。
6. 完成后汇报修改文件、验证命令、结果与剩余风险。

## 工程要求

- 文档使用简体中文，代码标识符和提交信息使用英文。
- 业务代码统一使用TypeScript，并保持严格类型检查。
- CodeArts是主智能体；MCP工具应保持确定性，不在工具内部重复实现Agent循环。
- 游戏模板默认采用Phaser、Vite和程序化占位素材。
- 不提交密钥、令牌、账号信息或本地环境文件。
- 新增功能必须同时给出可执行的验证方式。
- 实验结果应记录输入任务、使用模型、耗时、工具调用、人工干预和最终结果。
- 引用产品能力时优先采用官方文档，并记录访问日期。

## 架构分层

- 根目录 `AGENTS.md`：稳定项目规则、工程约束和安全边界；
- `.codeartsdoer/skills/`：由 CodeArts 按需加载的游戏生产流程，不保存 Provider 密钥或复制 MCP 实现；
- `packages/mcp-server/`：确定性工具边界，负责校验、生成、资产、预览、验收和 Run 协调，不实现 Agent 循环；
- `apps/workbench/` 与 `apps/tui/`：只读状态投影与显式用户控制界面，不承担需求理解和自主执行；
- `packages/opencode-plugin/`：可选的薄集成层，只做可用性提示、状态工具和通知，不承载 GameForge 核心业务。

GameForge 核心不得实现为 OpenCode Plugin。CodeArts/OpenCode 适配器可以调用 Relay 与 MCP，但核心契约、生成器、资产存储、浏览器验收和事件状态必须保持客户端无关。

## 安全边界

- 未经明确授权，不执行部署、发布、删除远程资源或修改仓库权限。
- 执行来源不明的脚本前必须先检查内容。
- 外部依赖应锁定版本并说明用途。
- 当前不得执行抖音小游戏平台 preview、上传、提审或发布；`tt-minigame-ide-cli` 只允许对官方 `bin/tmg.js` 执行固定 `--version` 探针，DevTool 本地导入与模拟器证据另行记录。
