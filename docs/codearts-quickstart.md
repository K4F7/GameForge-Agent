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
4. 安装后按客户端引导完成浏览器授权；该 OAuth 会话供交互 TUI 使用。

非交互 `codearts run` 当前不复用 TUI OAuth。按华为云 CLI 授权文档在本机设置 `CODEARTS_CLI_AK` 与 `CODEARTS_CLI_SK` 环境变量，并重新打开终端；不要把值放进命令参数、MCP 配置、日志或仓库。可只检查变量是否存在，禁止打印值。仓库启动器会继承当前进程环境，但不会读取认证存储或把凭据写入临时配置。

Linux/macOS产品页当前提供的CLI安装方式为：

```bash
sh -c "$(curl -L https://cnnorth4-cloudide-marketplace.obs.cn-north-4.myhuaweicloud.com/codearts/cli_tui/install_script/install.sh)" \
  && export PATH=~/.codeartsdoer/installers:$PATH
```

执行远程安装脚本前，应先从官方产品页核对地址并检查脚本内容。

## 3. 打开项目

本机同时安装独立 OpenCode 时，优先从仓库运行 `bun run codearts`，不要让两个客户端共用 OpenCode 默认数据库。CodeArts 26.6.2 与 OpenCode 1.18.3 已实际观察到不同迁移数量；共享 `%USERPROFILE%\.local\share\opencode\opencode.db` 会分别触发重复列或重复表错误。仓库启动器把 CodeArts 指向 `%USERPROFILE%\.codeartsdoer\cli-data`，OpenCode 保持自己的默认数据目录。迁移数据库前必须停止两端进程并备份，禁止手工删除列或伪造 migration 记录。

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
bun run doctor:douyin
bun run doctor:browser
bun run dev:local
```

`doctor` 使用真实 MCP SDK stdio Client 启动构建后的 Node 服务，输出 JSON：`ok`、Node/Bun 版本、锁文件状态、已注册工具、无密钥 capability snapshot 和稳定问题码。它校验每个 ready 能力的条件工具；Task Inbox ready 时还调用一次有界、只读 `list_game_tasks({limit: 1})`，验证 Relay URL 可达。配置抖音小游戏 CLI probe 时，它只调用一次 `get_douyin_mini_game_cli_status`，后者以当前 Node 固定执行 `bin/tmg.js --version`。它只确认 `create_game_task` 已注册，不调用这个写入工具。基础无密钥环境下 Provider/engineering 的 `ready: false` 是预期结果；在 CodeArts 同一环境变量下重跑时，应与准备启用的工具一致。该命令不执行任何模型或媒体请求，也不登录、预览、上传、提审或发布。

`doctor:douyin` 是独立的平台 CLI 策略诊断。未配置 `GAMEFORGE_DOUYIN_MINIGAME_CLI` 时会如实报告 optional probe 未启用且本地 Laya/validator 流程不受影响；配置后只接受绝对普通文件并要求 `tt-minigame-ide-cli` 2.1.1。小程序 `tt-ide-cli`/`tma` 0.1.33 会因版本与产品边界不符而拒绝。

`doctor:browser` 是独立的 Node/Chrome 启动探针，不打开项目页面，也不读取用户浏览器 profile。默认使用 Playwright `channel: chrome`；设置 `GAMEFORGE_CHROME_EXECUTABLE` 时先验证绝对路径可访问，再使用该可执行文件。成功后会关闭 browser，仅输出运行时、模式、耗时和脱敏错误。

如需本地任务跨 Relay 重启恢复，先在启动 `dev:local` 的终端设置 `GAMEFORGE_RUN_RELAY_STATE_FILE` 为绝对路径。PowerShell 示例：

```powershell
$env:GAMEFORGE_RUN_RELAY_STATE_FILE="D:\GameForgeState\relay-state.json"
bun run dev:local
```

`dev:local` 使用 Bun 并行启动示例游戏、Run Relay 和持久 Douyin Bridge Host，不启动 GUI 或 stdio MCP。然后在 CodeArts IDE 中依次进入“设置 → MCP工具 → 配置MCP”，打开官方 `mcp_settings.json`。根据官方 `mcpServers` 通用模板添加以下配置；把两个示例绝对路径替换为本机路径，Windows JSON 路径中的反斜杠必须写成 `\\`：

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
        "GAMEFORGE_LAYAIR_CLI": "C:\\Users\\you\\.layaair\\layaair.cmd",
        "GAMEFORGE_RUN_RELAY_URL": "http://127.0.0.1:8787/",
        "GAMEFORGE_DOUYIN_BRIDGE_MODE": "host",
        "GAMEFORGE_MCP_AUDIT_DIR": "D:\\GameForgeAudit"
      }
    }
  }
}
```

`host` 模式让 CodeArts 的 stdio MCP 通过 `%TEMP%/gameforge-douyin-bridge-host.json` 中的本地随机端口和 token 访问持久 Bridge Host。该文件只用于本机进程认证，不纳入仓库；MCP 会话退出不会关闭 DevTool 连接。Bridge Host 在 controller、HTTP 监听或 rendezvous 写入任一启动阶段失败时，必须停止已分配资源并释放仍由当前进程持有的 host lock，不能让失败启动阻塞后续实例。未设置该变量时继续使用兼容的 `embedded` 模式，controller 生命周期仍跟随单个 MCP 进程。

`GAMEFORGE_LAYAIR_CLI` 必须是固定 LayaAir 3.4.0 CLI 的绝对普通文件路径。官方 `dispatcher.js`、`layaair.cmd`、`layaair` 或 `Resources/cli-main.js` 入口只用于定位安装：Builder 核验 `versions.json`、`Resources/package.json` 与固定的 `Resources/cli-main.js` 后，以当前 Node、`shell: false` 和受限环境直接运行主入口，不执行 `.cmd` wrapper，也不继承用户 PATH 或凭据。与项目输出根同时配置后，MCP 同时注册 `build_douyin_mini_game` 与 `build_wechat_mini_game`，只对 target 匹配的托管 Manifest 分别执行一次固定 `bytedancegame` 或 `wxgame` 构建并离线校验；不接受任意命令/参数，不登录、预览、上传、提审或发布。CLI 缺失、版本不符、并发锁、超时、非零退出、路径/符号链接异常或包体校验失败都返回稳定错误。

需要让 CodeArts 只读确认抖音小游戏平台 CLI 前置时，可另外设置：

```text
GAMEFORGE_DOUYIN_MINIGAME_CLI=<tt-minigame-ide-cli 2.1.1 包内 bin/tmg.js 的绝对路径>
```

启动器会核验该入口是绝对、已存在、非符号链接的普通文件；probe 还会核验相邻 `package.json` 的 name、version 与 bin 映射。MCP 只注册允许自动执行的 `get_douyin_mini_game_cli_status`，且内部固定参数为 `--version`。项目 `version` 子命令、登录、打开、`set-config`、`build-npm`、`preview` 和 `upload` 都不在工具面中；当前项目策略同时禁止提审和发布。未安装 `tmg` 不影响 GameForge 的 LayaAir 本地构建与静态校验。

这里使用 Node 承载正式 MCP 和 Playwright Core；依赖安装、workspace 命令、检查和构建仍统一由 Bun 完成。官方配置要求 `command` 必填，`args` 和 `env` 可选，且所有环境变量值必须是字符串。保存后在“已安装”页签重启 `gameforge` MCP；官方文档明确指出修改环境变量后需要重启才能立即生效。

OpenCode-compatible 启动器把客户端工作目录固定为仓库根，并只生成本地 MCP 官方字段 `type`、`command`、`environment`、`enabled`、`timeout`；CodeArts 26.6.2 会拒绝非标准 `cwd`。客户端 MCP timeout 固定为 180 秒，使有 120 秒内部硬界限的浏览器验收能够返回，同时工具自身仍负责更短的确定性超时。变量未设置时动态配置不注入 token 引用；显式设置为空白会在写配置前 fail-closed，非空 token 继续执行 32–512 字符校验。

通过 `bun run codearts` 使用动态配置时，可在新终端显式设置 `GAMEFORGE_LAYAIR_CLI`。启动器只接受绝对、已存在、非符号链接的普通文件并将路径写入被忽略的临时配置；未设置时不猜测用户目录或 PATH，显式空白会直接拒绝。MCP 启动后仍会独立核验 CLI 版本精确为 3.4.0，并把官方 wrapper 解析到已核验的固定 `Resources/cli-main.js`，不经 shell 执行 wrapper。

`GAMEFORGE_MCP_AUDIT_DIR` 默认关闭；配置绝对目录后，每次 MCP 启动会创建一个唯一 JSON 会话文件。文件只含工具名、顺序、时间、耗时和结果状态，不含调用参数或返回值。`bun run codearts`/`bun run opencode` 启动器会自动使用仓库忽略目录；手工配置时不要指向同步盘或公开目录。单次隔离实验也可改用未存在的绝对 `GAMEFORGE_MCP_AUDIT_FILE`，两者不能同时配置。

若 Relay 进程启用了 `GAMEFORGE_RUN_RELAY_TOKEN`，CodeArts 启动环境与 Relay 必须使用同一个至少 32 字符的值；手工 MCP 配置可在本机私有 `env` 中增加该项，但不得提交。仓库生成的 OpenCode 配置只保存 `{env:GAMEFORGE_RUN_RELAY_TOKEN}` 引用。浏览器 GUI 不接收此秘密；带认证的浏览器访问必须通过同源认证代理。

此基础配置不包含任何密钥，会注册规格校验、项目生成、任务/Run、浏览器验收与预览工具。当前阶段只使用 CodeArts 内置模型，不配置或调用 Qwen、Seedream、Freesound、MiniMax 或火山 TTS 外部账号；这些适配器与 README 变量只保留给未来获得新授权后的显式实验。不要把填入真实值的 `mcp_settings.json` 提交到仓库。是否配置成功以 CodeArts 实际列出的工具为准，不以前端 Provider 标签为准。

首次联调按以下顺序检查：

1. 在 CodeArts 中确认可见 `create_game_task`、`list_game_tasks`、`claim_game_task` 和 `replay_game_run`；
2. 选择一种 Task 入口：
   - 纯 CLI/TUI：经客户端 `ask` 确认后调用一次 `create_game_task`，传入新的唯一 `runId`、用户原始 `prompt`、明确的 `language`，迭代项目再显式传 `projectId`；保存完整请求，响应不确定时只用相同参数重试；
   - 当前仓库没有状态界面入口；原版 OpenChamber GUI 的测试接入由外置测试框架另行实现。
3. 调用一次不带 status 的 `list_game_tasks`；若存在 `claimedBy: "codearts"` 的相关 Task，优先幂等恢复，否则认领刚创建或明确匹配当前需求的 queued Task。不得认领无关任务；认领结果中的可选 `projectId` 决定 update/create，禁止从 Prompt 或目录猜测；
4. 以 `agentId: "codearts"` 调用 `claim_game_task`。若已注册 `bind_mcp_audit_context`，经 `ask` 后以认领返回的 Task/Run ID 绑定一次审计，相同绑定可幂等恢复；
5. 按 `gameforge-build` Skill 完成规格、生成、验收和目标平台构建。外置测试框架只负责操作和观察，不参与 Agent 规划；
6. 有状态界面时，确认它显示真实规格、素材和本次生成项目，而不是演示数据；纯 CLI 流程则以连续 RunEvent 回放和托管产物为证据。

`create_game_task` 的 MCP annotations 声明它是封闭域内、非破坏性且相同参数幂等的写入操作；annotations 只是客户端提示，不是授权。OpenCode 模板仍将 `create_*` 设为 `ask`，CodeArts 也应保留对应人工确认。相同 run ID 携带不同 Prompt、language 或 projectId 会返回 `task_run_conflict`；不得静默轮换 ID 后继续。

双语验收时，创建明确使用 `en-US` 的新 Task。CodeArts 读取 Task 后应把两个字段原样传递：

```text
draft_game_spec({ prompt: task.prompt, language: task.language })
```

确认 `spec.ready.spec.locale` 为 `en-US`、预览 HUD 显示 `Progress`/`Lives`，且浏览器 `document.documentElement.lang` 为 `en-US`。再用新 Run 做一次中文对照。Provider 会拒绝 locale 与请求 language 不一致的模型输出。

本仓库的本地 MCP Client、Relay 和浏览器实验不能代替真实 CodeArts 使用。第一阶段脱敏记录应至少证明：CodeArts 客户端版本、登录状态、已安装 `gameforge` MCP、Task ID/Run ID、`claim_game_task` 的 agent ID、实际工具调用摘要、最终 `run.completed` 与浏览器证据。2026-07-18 曾使用 CodeArts 26.6.2 OAuth TUI 完成历史闭环，记录见 `experiments/2026-07-18-codearts-real-e2e/`；该次 Task 由现已删除的 Workbench 创建，本次媒体能力未启用，因此不证明当前 UI 框架或真实云 Provider 调用。

同日又使用非交互 CodeArts、内置 `huaweicloud-maas/GLM-5.1` 和临时无持久化 Relay，真实完成 `create_game_task → claim_game_task → replay_game_run`。MCP Audit 记录三个成功调用，Relay 只有唯一 `run.started`；CodeArts 未修改项目或调用媒体 Provider。记录见 `experiments/2026-07-18-codearts-headless-task-create/`。这证明无 GUI Task 启动协议，不等同于完整小游戏生产、平台构建或真机验收。

随后使用非交互 CodeArts、内置 `huaweicloud-maas/deepseek-v3.2`、隔离持久化 Relay 和 LayaAir CLI 3.4.0，真实完成抖音小游戏 Task 创建、认领、规格、项目生成、双终态玩法验收、静态构建、事件发布与 Run 完成。16 次 GameForge MCP 调用均成功；严格 record 只保存脱敏摘要。记录见 `experiments/2026-07-18-codearts-douyin-full/`。该证据证明无 GUI 本地生产链路，不证明开发者工具、真机、上传、审核或发布。

官方 MCP 页面访问日期：2026-07-16。

仓库已用真实 MCP SDK 客户端验证上述 `node + dist/index.js + env` stdio 方式可以握手并列出无密钥基础工具；历史 `dev:local` 三服务结果见 `experiments/2026-07-16-local-bootstrap/`，当前命令不再启动 Workbench。

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

命令从配置的 `GAMEFORGE_RUN_RELAY_URL`（默认 loopback 8787）分页读取完整保留期事件，校验定义、sequence 和终态。客户端版本、模型和人工干预只能写入 metadata；缺失工具历史时必须使用 `count: null`/`errors: null`，不得从 RunEvent 数量推断。选择已由 `bind_mcp_audit_context` 绑定的 MCP 会话 audit 后，capture 会将其 Task/Run 与 Relay 权威 Task 交叉核验，再机械计算工具总数、唯一名称与错误数；未绑定、错绑定或截断文件都会被拒绝。浏览器完成证据来自 `verification.ready`；小游戏定义还必须显式写入 `platform` 和 `runtimeGenre`，并由同项目、同 target、同规格参数且顺序正确的 `gameplay.verified` 与 `build.ready` 共同证明。record 保存绑定 ID、session ID 与内容 SHA-256，采用 allowlist 摘要，不包含 Task Prompt、调用参数/结果、日志正文、素材提示、URL、绝对路径、模板哈希或 TTS job handle，并拒绝覆盖已有 record。

## 官方文档

- [IDE快速启动](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0002.html)
- [CLI产品概述](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0001.html)
- [CLI下载安装](https://codearts.huaweicloud.com/download.html)
- [Rules](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0019.html)
- [Skills](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0024.html)
- [MCP](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)
