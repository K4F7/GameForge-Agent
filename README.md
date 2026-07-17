# GameForge Agent

基于华为云码道（CodeArts）代码智能体的全流程小游戏工程实验项目。

当前阶段聚焦三件事：

1. 以CodeArts Agent作为需求理解、规划和多智能体编排中枢。
2. 使用TypeScript实现可审计、可测试的MCP工具和游戏模板。
3. 建立可复现的CodeArts Agent配置、开发和评测流程。

## 仓库结构

```text
.
├── AGENTS.md                         # CodeArts/Codex 共享项目规则
├── .codeartsdoer/skills/             # CodeArts项目级Skills
├── apps/game/                         # Phaser + Vite示例游戏
├── apps/workbench/                    # React + Vite Agent工作台
├── apps/tui/                          # Bun终端任务与RunEvent客户端
├── packages/contracts/               # 需求与游戏规格Schema
├── packages/generator/               # 固定模板的安全项目生成器
├── packages/game-verifier/           # Playwright可玩性、诊断与截图验收
├── packages/mcp-server/              # CodeArts可调用的MCP工具
├── packages/providers/               # 国产模型与媒体Provider适配器
├── packages/run-relay/               # RunEvent回放与SSE中继
├── packages/opencode-plugin/          # 可选薄插件：状态提示与通知
├── packages/benchmark/                # 客户端同任务指纹与对比报告
├── integrations/codearts/             # CodeArts动态启动适配
├── integrations/opencode/             # OpenCode动态启动适配
├── docs/
│   ├── codearts-quickstart.md         # 安装与首次验证
│   ├── comparison.md                 # 三种代码智能体对比
│   ├── model-media-strategy.md       # 国产模型、生图、TTS与音效策略
│   ├── game-generation-runtime.md    # 项目生成器与事件服务
│   ├── roadmap.md                    # CodeArts 实验与第二轮 TUI/GUI 计划
│   ├── codearts-opencode-analysis.md # CodeArts 与 OpenCode 官方资料研判
│   └── open-source-references.md      # 可借鉴的游戏Agent与前端开源项目
└── experiments/                      # 后续基准任务与实验记录
```

## 第一阶段里程碑

- [x] 安装并通过 OAuth 登录 CodeArts Agent CLI/TUI
- [x] 用 CodeArts 打开本仓库并加载项目级上下文
- [x] 验证根 `AGENTS.md` 与 `.codeartsdoer/AGENTS.md` 分层
- [x] 加载项目级 GameForge 生产 Skill
- [x] 完成一个真实“理解—生成—构建—浏览器验收—报告”基准任务
- [x] 保存脱敏事件、人工干预和测试结果

## 技术底座

- CodeArts Agent：主智能体、规则、Skills和Agent Team。
- TypeScript：全部业务代码与工具代码。
- Phaser 4：浏览器2D游戏引擎。
- MCP TypeScript SDK：向CodeArts暴露确定性工程工具。
- Zod：需求和游戏规格校验。
- Vite + Vitest：构建和自动化测试。

## 快速开始

```bash
bun install --frozen-lockfile
bun run build
bun run bundle:check
bun run test
bun run audit
bun run doctor
bun run dev:local
bun run tui -- list
```

`bun run doctor` 会构建基础包与 MCP，然后用真实 Node stdio Client 检查运行时版本、Bun 单锁、生产入口、必需工具、本次 capability snapshot 及 ready 能力对应的条件工具。配置 Task Inbox 时还会执行一次 `{limit: 1}` 的只读 Relay 探测，因此不可达 URL 不会显示绿灯。它不调用云 API、不输出凭据；可在与 CodeArts 相同的环境变量下运行，以提前发现半配置和路径错误。

`dev:local` 通过 Bun 并行启动示例游戏（5173）、Workbench（4173）和 Run Relay（8787）。仅在 Vite 开发模式且未显式配置时，Workbench 默认连接 `http://127.0.0.1:8787/`；生产构建仍要求设置 `VITE_AGENT_BASE_URL`。MCP 是 stdio 子进程，应由 CodeArts 启动，不包含在该并行命令中。生产式本地联调先执行 `bun run build`，再使用 `bun run start:relay`；CodeArts MCP 配置见 [CodeArts 快速开始](docs/codearts-quickstart.md)。

示例游戏和生成模板先输出轻量加载壳，再异步加载 Phaser 游戏块；这会显著缩小首屏入口并改善首次绘制与长期缓存，但不会虚报 Phaser 总下载量减少。`bun run bundle:check` 根据 Vite manifest 分别约束初始、异步和总 raw/gzip 体积，预算超出时返回非零退出码。

第二轮 Bun TUI MVP 位于 `apps/tui`，复用严格 Schema 的 Run Relay Client，不包含 Agent 循环。它支持提交/列出/查看 Task、回放/停止 Run，以及通过 SSE 实时观察连续 RunEvent；`--json` 在无 TTY 环境逐行输出可机器处理的 JSON。完整命令见 [TUI 使用说明](docs/tui.md)。

客户端基准使用规范化任务定义的 SHA-256，而不是要求 CodeArts 与 OpenCode 复用同一个 Task ID。运行 `bun run benchmark -- report definition.json codearts.record.json opencode.record.json --out report.md` 可校验记录并生成对比；只有两端都完成时才允许比较工作流质量。

## 集成边界

GameForge 核心不实现为 OpenCode Plugin。核心由客户端无关的 contracts、Provider 适配器、生成器、Asset Store、Verifier、Run Relay 和确定性 MCP 组成；CodeArts 与 OpenCode 只是可替换的主智能体/宿主。

- `AGENTS.md`：规则；
- `.codeartsdoer/skills/`：生产流程；
- MCP：确定性工具；
- Workbench/TUI：状态界面；
- OpenCode Plugin：可选的可用性检测、会话提示、状态工具和通知。

可提交的 [`opencode.json.example`](opencode.json.example) 不包含绝对路径或密钥。复制为本地配置前设置 `GAMEFORGE_PROJECT_OUTPUT_ROOT` 和 `GAMEFORGE_RUN_RELAY_URL`；权限默认让校验/查询类工具直接执行，让项目生成、资产导入、预览启停和 Run 终态操作请求确认。跨平台动态启动器见 `integrations/`。

仓库统一使用 Bun 1.3.14 或更高版本和 `bun.lock`；仓库级 `.npmrc` 固定 npm 官方 registry，以确保 Phaser 4.2.1 与安全审计元数据可复现。不要再生成或提交 npm、pnpm、Yarn 的并行锁文件。

启用阿里云百炼 Qwen 的结构化 GameSpec 草拟工具时，在启动 MCP 服务的进程环境中设置：

```text
DASHSCOPE_API_KEY=<阿里云百炼 API key>
GAMEFORGE_SPEC_MODEL=qwen3.6-flash
```

`GAMEFORGE_SPEC_MODEL` 可省略，默认使用 `qwen3.6-flash`。只有设置 `DASHSCOPE_API_KEY` 时，MCP 才注册 `draft_game_spec`；该工具通过百炼官方 OpenAI 兼容接口发起一次非流式请求，要求严格 JSON Schema 输出，并再次按仓库 `GameSpec` Schema 校验。密钥只从服务端环境读取，不进入工具参数、日志或仓库。

`get_gameforge_capabilities` 始终注册，返回本次 MCP 进程实际可用的国产模型、媒体和工程能力布尔快照，不返回密钥、Token、主机白名单或本机路径。CodeArts 将它发布为 `capabilities.ready` 后，Workbench 才把对应 Provider 标记为“本次 MCP 已配置”；未收到事件时显示等待，完整依赖链缺一项时显示未配置。

启用许可证过滤的音效搜索工具时，在启动MCP服务的进程环境中设置：

```text
FREESOUND_API_KEY=<Freesound API v2 token>
FREESOUND_API_USAGE=non-commercial
```

`FREESOUND_API_USAGE`也可以设为`commercial-agreement`，但仅应在项目已与Freesound取得商业API使用协议后使用。未设置密钥时，MCP服务不会注册`search_sound_asset`，也不会在工具参数中接收密钥。

启用确定性项目生成工具时设置服务端绝对输出目录：

```text
GAMEFORGE_PROJECT_OUTPUT_ROOT=D:\GameForgeGenerated
```

配置输出目录后同时注册 `verify_game_project`、`start_game_preview` 和 `stop_game_preview`。预览工具只为生成器托管项目启动随机端口的 loopback Vite 服务，不执行目标项目的 `vite.config.ts`；相同项目的并发启动会合并为一个会话。验收工具默认调用系统 Chrome；如果运行环境无法通过 Playwright 的 `chrome` channel 找到浏览器，可显式设置：

```text
GAMEFORGE_CHROME_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe
```

同一输出目录还注册 `get_project_assets`，用于 CodeArts 重启后读取并验证已落盘 Manifest，补发缺失的 `asset.ready`，而不是重复生成或下载已有素材。

验收工具只处理生成器托管的项目，动作脚本最多 100 步；运行时阻断外部网络，捕获控制台错误、页面异常和失败请求，并等待 telemetry 与非空白 Canvas 首帧后再读取 `window.__GAMEFORGE_TEST__` 和截图，避免把刚创建但尚未渲染的 Canvas 误报为通过。证据写入项目的 `.gameforge/verification/`。CodeArts 将验收摘要发布为 `verification.ready`，Workbench 显示胜负状态、诊断计数和项目内证据路径；绝对路径与诊断全文不进入浏览器事件流。CodeArts 可将 `start_game_preview` 返回的 URL 原样发布为 `preview.ready` RunEvent；Workbench 收到后自动切换预览。事件 URL 只接受 HTTPS 或 loopback HTTP，iframe 使用受限 sandbox。

启用 Run Relay 生命周期工具：

```text
GAMEFORGE_RUN_RELAY_URL=http://127.0.0.1:8787/
```

Run Relay 默认仍使用内存状态。需要让 Task、RunEvent 和游标跨正常进程重启恢复时，在启动 Relay 的进程环境中设置绝对状态文件路径：

```text
GAMEFORGE_RUN_RELAY_STATE_FILE=D:\GameForgeState\relay-state.json
```

Relay 对每次成功变更串行写入严格 Schema 快照，使用同目录临时文件、文件同步和原子 rename；启动时拒绝相对路径、符号链接、超限或 Task/Run 终态不一致的快照。状态文件含用户 Prompt 与运行日志，应置于受限本地目录，不提交仓库。MCP 的 `GAMEFORGE_RUN_RELAY_URL` 与 Relay 的 `GAMEFORGE_RUN_RELAY_STATE_FILE` 属于两个不同进程的配置。

启用 Seedream 生图并把结果写入已生成项目：

```text
VOLCENGINE_ARK_API_KEY=<方舟 API key>
GAMEFORGE_IMAGE_MODEL=<控制台中已开通的模型 ID>
GAMEFORGE_IMAGE_LICENSE=<当前账号与用途对应的输出许可说明>
GAMEFORGE_IMAGE_REFERENCE_HOSTS=example-oss.cn-beijing.aliyuncs.com
```

只有同时设置 `GAMEFORGE_PROJECT_OUTPUT_ROOT` 和上述三个必填变量时，MCP 才注册 `request_image_asset`。其角色只能是 `player`、`collectible`、`hazard` 或 `background`；无效音频角色会在调用 Seedream 前被 MCP Schema 拒绝。Seedream 等生图模型输出的角色图片会在生成游戏中归一化到固定显示尺寸与碰撞体，不让源分辨率改变玩法尺度。Freesound 与输出目录均配置后，还会注册 `import_sound_asset`；它只下载搜索结果中的官方 preview，不把 Token 拼入 URL，也不替代需要 OAuth2 的原始文件下载接口。选择 `collect-sound` 或 `hit-sound` 时按音效入库，明确选择 `bgm` 时按音乐入库；生成游戏会在玩家第一次交互后循环播放 BGM。

启用火山引擎异步长文本配音：

```text
VOLCENGINE_SPEECH_API_TOKEN=<豆包语音 API token>
VOLCENGINE_SPEECH_APP_ID=<应用 ID>
GAMEFORGE_TTS_LICENSE=<当前账号与用途对应的输出许可说明>
GAMEFORGE_TTS_AUDIO_HOSTS=<控制台/真实 query 响应确认的音频 CDN 主机，多个用逗号分隔>
```

不要猜测 `GAMEFORGE_TTS_AUDIO_HOSTS`；以当前账号真实返回的 `audio_url` 主机为准，只填写主机名。配置完整后注册 `submit_voice_job`、`query_voice_job` 和 `materialize_voice_job`。作业句柄经过 HMAC 签名并绑定项目；MCP 不会自动轮询，完成音频只允许从服务端白名单中的 HTTPS 主机下载。

工作台连接本地任务/RunEvent中继时设置`VITE_AGENT_BASE_URL=http://127.0.0.1:8787/`。配置后“提交给 CodeArts”会把当前 Prompt 写入受限任务收件箱，并原子创建对应 Run；MCP 同时注册 `list_game_tasks`、`get_game_task`、`claim_game_task`，供 CodeArts 读取和幂等认领。CodeArts 发布 `spec.ready`、`asset.ready`、`preview.ready` 后，Workbench 分别展示真实 GameSpec、已落盘资产及当前游戏预览；场景结构和地图视图由已验证 GameSpec 与资产清单确定性派生，明确标注真实绑定、程序化回退和“模板示意”边界。未收到事件时显示等待状态，不使用硬编码生产结果。Relay 不调用模型，也不自动执行任务。完整接口、安全边界和验证步骤见[确定性游戏生成与运行事件服务](docs/game-generation-runtime.md)。

Task 创建以 Run ID 作为幂等键：网络响应丢失后，以完全相同的 Run ID、Prompt 和语言重试会返回原 Task 与原始 `run.started`，不会重复排队；同 Run ID 携带不同内容会返回稳定的 `task_run_conflict`。一个 Run ID 只代表一次不可变任务，完成新需求时应使用新的 Run ID。

Workbench 可选择 `zh-CN` 或 `en-US`。语言随 Task 进入权威 `run.started`，因此重连与事件回放可以恢复选择；CodeArts 必须把 Task 的 Prompt 与 language 原样传给 `draft_game_spec`。百炼返回的 `GameSpec.locale` 不匹配时会被拒绝，生成项目的静态 HTML `lang`、无障碍标签和 Phaser HUD/控制提示均随 locale 输出；旧规格缺少 locale 时仍默认中文。

Workbench 会为每次页面会话准备唯一 Run ID；连接期间输入锁定。若提交响应不确定，直接保留当前 ID 重试；若要开始不同需求，先停止或等待当前 Run 终止，再点击“新任务”显式轮换 ID。不要手工修改已连接 Run 的 ID。

当前机器已安装 CodeArts Agent 客户端；真实 CodeArts 端到端验收不能由本地 MCP Client 替代。可执行步骤、已通过证据与第二轮 TUI/GUI TODO 见 [路线图](docs/roadmap.md)。

2026-07-18 已使用 CodeArts 26.6.2 OAuth TUI 和临时隔离配置完成首个真实闭环：CodeArts 启动 `gameforge` stdio MCP、认领 Workbench Task、发布 capability 与英文 GameSpec、生成并构建 Phaser 项目、取得真实 Chrome `won` 证据、发布 preview/verification 并完成 Run。云 Provider 均未配置也未调用。详见 [`2026-07-18-codearts-real-e2e`](experiments/2026-07-18-codearts-real-e2e/result.md)。

先阅读 [CodeArts 快速开始](docs/codearts-quickstart.md)，然后在 CodeArts 智能体模式中输入：

```text
阅读 AGENTS.md 和 docs 目录，总结当前项目目标；不要修改文件。然后列出完成第一个可复现实验所需的步骤和验收条件。
```

## 资料来源

- [CodeArts Agent 产品文档](https://support.huaweicloud.com/productdesc-codeartssnap/codeartsdoer_pd_0001.html)
- [CodeArts Agent CLI](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0001.html)
- [CodeArts Skills](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0024.html)
- [CodeArts MCP](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)
- [CodeArts 与 OpenCode 官方资料研判](docs/codearts-opencode-analysis.md)
- [分层架构与 MCP 权限](docs/architecture-layers.md)
- [CodeArts/OpenCode 动态启动器](integrations/README.md)
