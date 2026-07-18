# CodeArts Agent 快速开始

更新日期：2026-07-18

## 1. 选择使用形态

- 初次学习和观察Agent行为：优先使用CodeArts Agent IDE。
- 日常终端交互：使用TUI。
- 批处理、脚本和后续自动化评测：使用CLI。
- 观察多智能体任务拆解：使用Agent Space中的Agent Team。

## 2. 准备账号和客户端

1. 注册华为云账号。
2. 开通CodeArts Agent体验版、基础版或专业版。
3. 从CodeArts产品官网下载IDE或CLI。
4. 安装后按客户端引导完成浏览器授权。

Linux/macOS产品页当前提供的CLI安装方式为：

```bash
sh -c "$(curl -L https://cnnorth4-cloudide-marketplace.obs.cn-north-4.myhuaweicloud.com/codearts/cli_tui/install_script/install.sh)" \
  && export PATH=~/.codeartsdoer/installers:$PATH
```

执行远程安装脚本前，应先从官方产品页核对地址并检查脚本内容。

## 3. 打开项目

在CodeArts Agent IDE中可以：

- 导入本地文件夹；
- 新建项目；
- 克隆Git仓库。

本仓库推送到GitHub后，推荐直接使用“克隆Git仓库”，确保实验环境可重建。

## 4. 验证项目规则

CodeArts兼容项目根目录的`AGENTS.md`。打开项目后，在智能体模式输入：

```text
读取并概括当前项目规则。只汇报，不修改文件。
```

预期结果应包含：先检查上下文、实际运行验证、禁止虚构测试结果、记录实验数据等要求。

## 5. 使用项目级Skill

CodeArts项目级Skill位于：

```text
.codeartsdoer/skills/<skill-name>/SKILL.md
```

在对话中可以直接描述任务让智能体自动选择，也可以通过`/`菜单显式调用。

## 6. 使用MCP

华为云官方文档当前支持本地 stdio、SSE 和 Streamable HTTP 三类配置。本仓库使用官方 stdio 方式：MCP 由 CodeArts 启动，工具通过标准输入输出通信；Run Relay 则是独立 HTTP 服务。官方建议同时启用的 MCP 保持精简，启用 3 个可获得最优使用体验。

先在仓库根目录执行：

```text
bun install --frozen-lockfile
bun run build
bun run doctor
bun run doctor:browser
bun run dev:local
```

`doctor` 使用真实 MCP SDK stdio Client 启动构建后的 Node 服务，输出 JSON：`ok`、Node/Bun 版本、锁文件状态、已注册工具、无密钥 capability snapshot 和稳定问题码。它校验每个 ready 能力的条件工具；Task Inbox ready 时还调用一次有界、只读 `list_game_tasks({limit: 1})`，验证 Relay URL 可达。基础无密钥环境下 Provider/engineering 的 `ready: false` 是预期结果；在 CodeArts 同一环境变量下重跑时，应与准备启用的工具一致。该命令不执行任何模型或媒体请求。

`doctor:browser` 是独立的 Node/Chrome 启动探针，不打开项目页面，也不读取用户浏览器 profile。默认使用 Playwright `channel: chrome`；设置 `GAMEFORGE_CHROME_EXECUTABLE` 时先验证绝对路径可访问，再使用该可执行文件。成功后会关闭 browser，仅输出运行时、模式、耗时和脱敏错误。

如需本地任务跨 Relay 重启恢复，先在启动 `dev:local` 的终端设置 `GAMEFORGE_RUN_RELAY_STATE_FILE` 为绝对路径。PowerShell 示例：

```powershell
$env:GAMEFORGE_RUN_RELAY_STATE_FILE="D:\GameForgeState\relay-state.json"
bun run dev:local
```

`dev:local` 使用 Bun 并行启动示例游戏、Workbench 和 Run Relay，不启动 stdio MCP。然后在 CodeArts IDE 中依次进入“设置 → MCP工具 → 配置MCP”，打开官方 `mcp_settings.json`。根据官方 `mcpServers` 通用模板添加以下配置；把两个示例绝对路径替换为本机路径，Windows JSON 路径中的反斜杠必须写成 `\\`：

```json
{
  "mcpServers": {
    "gameforge": {
      "command": "node",
      "args": [
        "D:\\path\\to\\GameForge-Agent\\packages\\mcp-server\\dist\\index.js"
      ],
      "env": {
        "GAMEFORGE_PROJECT_OUTPUT_ROOT": "D:\\GameForgeGenerated",
        "GAMEFORGE_RUN_RELAY_URL": "http://127.0.0.1:8787/",
        "GAMEFORGE_MCP_AUDIT_DIR": "D:\\GameForgeAudit"
      }
    }
  }
}
```

这里使用 Node 承载正式 MCP 和 Playwright Core；依赖安装、workspace 命令、检查和构建仍统一由 Bun 完成。官方配置要求 `command` 必填，`args` 和 `env` 可选，且所有环境变量值必须是字符串。保存后在“已安装”页签重启 `gameforge` MCP；官方文档明确指出修改环境变量后需要重启才能立即生效。

`GAMEFORGE_MCP_AUDIT_DIR` 默认关闭；配置绝对目录后，每次 MCP 启动会创建一个唯一 JSON 会话文件。文件只含工具名、顺序、时间、耗时和结果状态，不含调用参数或返回值。`bun run codearts`/`bun run opencode` 启动器会自动使用仓库忽略目录；手工配置时不要指向同步盘或公开目录。单次隔离实验也可改用未存在的绝对 `GAMEFORGE_MCP_AUDIT_FILE`，两者不能同时配置。

此基础配置不包含任何密钥，会注册规格校验、项目生成、任务/Run、浏览器验收与预览工具。需要 Qwen、Seedream、Freesound 或火山 TTS 时，只在本机 `env` 中追加 README 所列变量；不要把填入真实值的 `mcp_settings.json` 提交到仓库。是否配置成功以 CodeArts 实际列出的工具为准，不以前端 Provider 标签为准。

首次联调按以下顺序检查：

1. 打开 `http://127.0.0.1:4173/`，提交一个 Prompt，记录 Task ID 与 Run ID；新项目将“继续项目”留空，迭代已有项目时显式填写其 `projectId`；
   页面刷新或切换任务后，可点击“刷新历史”读取最近 20 个 Task，再选择“载入历史”从 sequence 0 回放；该操作只读取 Relay，不认领或修改 Task。
2. 在 CodeArts 中确认可见 `list_game_tasks`、`claim_game_task` 和 `replay_game_run`；
3. 调用一次不带 status 的 `list_game_tasks`；若存在 `claimedBy: "codearts"` 的相关 Task，优先幂等恢复，否则认领刚创建的 queued Task；认领结果中的可选 `projectId` 决定 update/create，禁止从 Prompt 或目录猜测；
4. 按 `gameforge-build` Skill 完成规格、生成、验收和 `preview.ready`；
5. 确认 Workbench 显示真实规格、素材和本次生成项目，而不是演示数据。

双语验收时，在 Workbench 选择 `English (US)` 后提交新的 Run。CodeArts 读取 Task 后应把两个字段原样传递：

```text
draft_game_spec({ prompt: task.prompt, language: task.language })
```

确认 `spec.ready.spec.locale` 为 `en-US`、预览 HUD 显示 `Progress`/`Lives`，且浏览器 `document.documentElement.lang` 为 `en-US`。再用新 Run 做一次中文对照。Provider 会拒绝 locale 与请求 language 不一致的模型输出。

本仓库的本地 MCP Client、Relay 和浏览器实验不能代替真实 CodeArts 使用。第一阶段脱敏记录应至少证明：CodeArts 客户端版本、登录状态、已安装 `gameforge` MCP、Task ID/Run ID、`claim_game_task` 的 agent ID、实际工具调用摘要、最终 `run.completed` 与 Workbench/浏览器证据。该项已于 2026-07-18 使用 CodeArts 26.6.2 OAuth TUI 首次通过，记录见 `experiments/2026-07-18-codearts-real-e2e/`；本次媒体能力未启用，因此该实验不证明真实云 Provider 调用。

官方 MCP 页面访问日期：2026-07-16。

仓库已用真实 MCP SDK 客户端验证上述 `node + dist/index.js + env` stdio 方式可以握手并列出无密钥基础工具；`bun run dev:local` 也已取得游戏、Workbench 和 Relay 三个 HTTP 200。可复现记录见 `experiments/2026-07-16-local-bootstrap/`。

Run Relay 的可选状态文件已通过真实生产进程两次重启验证；记录见 `experiments/2026-07-16-relay-persistence/`。

## 7. 第一次基准实验

输入：

```text
检查这个仓库的文档结构，找出链接、术语或结构上的问题；先列验收条件，再完成最小修改，最后给出实际验证结果。
```

记录：

- 使用的CodeArts版本和模型；
- 总耗时；
- 读取、编辑和终端工具调用次数；
- 人工确认次数；
- 是否一次通过验证；
- 最终提交差异。

Task 到达终态后，先准备严格 `definition.json` 与人工核验的 `metadata.json`，再执行：

```powershell
bun run benchmark -- capture definition.json metadata.json --task-id <Task-ID> --mcp-audit <会话审计.json> --out codearts.record.json
```

命令从配置的 `GAMEFORGE_RUN_RELAY_URL`（默认 loopback 8787）分页读取完整保留期事件，校验定义、sequence 和终态。客户端版本、模型和人工干预只能写入 metadata；缺失工具历史时必须使用 `count: null`/`errors: null`，不得从 RunEvent 数量推断。选择正确 MCP 会话 audit 后，工具总数、唯一名称与错误数由严格调用记录机械计算；截断文件会被拒绝，record 同时保存 session ID 与内容 SHA-256。输出采用 allowlist 摘要，不包含 Task Prompt、调用参数/结果、日志正文、素材提示、URL、绝对路径或 TTS job handle，并拒绝覆盖已有 record。

## 官方文档

- [IDE快速启动](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0002.html)
- [CLI产品概述](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0001.html)
- [CLI下载安装](https://codearts.huaweicloud.com/download.html)
- [Rules](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0019.html)
- [Skills](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0024.html)
- [MCP](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)
