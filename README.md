# GameForge Agent

基于华为云码道（CodeArts）代码智能体的全流程小游戏工程实验项目。

产品第一版以可发布的抖音小游戏为首要目标，微信小游戏为第二导出目标；现有 Phaser + Vite 浏览器项目是快速预览与自动验收基线，不等同于平台发布产物。平台范围与验收门槛见 [ADR-0002](docs/decisions/0002-domestic-mini-game-v1.md) 和 [国内小游戏平台调研](docs/domestic-mini-game-platforms.md)。

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
├── apps/desktop/                      # Tauri 2最小权限桌面壳实验
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
│   ├── model-evaluation-2026-07.md    # 国产 SOTA、权威榜单与 oh-my-openagent 评估
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
bun run doctor:browser
bun run doctor:desktop
bun run workbench:smoke
bun run dev:local
bun run tui -- list
```

`bun run doctor` 会构建基础包与 MCP，然后用真实 Node stdio Client 检查运行时版本、Bun 单锁、生产入口、必需工具、本次 capability snapshot 及 ready 能力对应的条件工具。配置 Task Inbox 时还会执行一次 `{limit: 1}` 的只读 Relay 探测，因此不可达 URL 不会显示绿灯。它不调用云 API、不输出凭据；可在与 CodeArts 相同的环境变量下运行，以提前发现半配置和路径错误。

`bun run doctor:browser` 构建 Verifier 后使用正式 Node 运行时启动一次隔离的无页面 Chrome 会话并立即关闭，验证 `channel: chrome` 或 `GAMEFORGE_CHROME_EXECUTABLE`。Playwright 系统 Chrome 验收不支持由 Bun 进程直接承载；该路径会立即报错，避免已知的长时间悬挂。Bun 仍负责依赖、构建、测试和命令编排。

`bun run workbench:smoke` 在系统分配且始终保持绑定的随机 loopback 端口启动真实 Relay、生产 Workbench 静态服务与受控预览页，再用系统 Chrome 从表单提交一个 Task。确定性 fixture 认领该 Task 并发布合法的规格、资产、七阶段完成、预览、浏览器验收、日志和终态事件；命令验证 UI、iframe、100% 阶段进度、Relay sequence 1–14 连续性与三类浏览器诊断，截图和脱敏 JSON 写入忽略的 `output/playwright/`。它验证 Workbench/Relay 浏览器链路，不冒充 CodeArts 或国产 Provider 账号验收。

`dev:local` 通过 Bun 并行启动示例游戏（5173）、Workbench（4173）和 Run Relay（8787）。仅在 Vite 开发模式且未显式配置时，Workbench 默认连接 `http://127.0.0.1:8787/`；生产构建仍要求设置 `VITE_AGENT_BASE_URL`。MCP 是 stdio 子进程，应由 CodeArts 启动，不包含在该并行命令中。生产式本地联调先执行 `bun run build`，再使用 `bun run start:relay`；CodeArts MCP 配置见 [CodeArts 快速开始](docs/codearts-quickstart.md)。

`generate_game_project` 除安全新建外也支持受管更新。更新必须先 dry-run，再以返回的当前 plan SHA-256 做 apply CAS；只更新 Manifest 中哈希未变的生成器文件，运行时资产、`bun.lock`、未知文件和用户已修改代码都不会被覆盖。发生冲突时没有 force 开关，由 CodeArts 审阅并显式合并。

受管 update 在任何模板临时文件写入前创建 0600 的 `.gameforge/update.transaction.json`，记录 add/update/delete 的旧/新哈希和旧/新 Manifest 提交点。进程中断后，`recover_game_project_update` 会在 update lock 内以当前托管 Manifest 哈希决定整批回滚或完成清理；第三种状态、陌生路径、符号链接或哈希冲突都会拒绝。恢复工具不调用模型、媒体 Provider 或 Relay，OpenCode 权限为 `ask`。

示例游戏和生成模板先输出轻量加载壳，再异步加载 Phaser 游戏块；这会显著缩小首屏入口并改善首次绘制与长期缓存，但不会虚报 Phaser 总下载量减少。`bun run bundle:check` 根据 Vite manifest 分别约束初始、异步和总 raw/gzip 体积，预算超出时返回非零退出码。

第二轮 Bun TUI MVP 位于 `apps/tui`，复用严格 Schema 的 Run Relay Client，不包含 Agent 循环。它支持提交/列出/查看 Task、回放/停止 Run，以及通过 `follow TASK_ID` 自动解析 Run ID 后实时观察连续 RunEvent；断线后从最后连续游标执行有限退避回放，终态自动退出。`--json` 在无 TTY 环境只向 stdout 逐行输出可机器处理的 JSON，恢复进度写入 stderr。完整命令见 [TUI 使用说明](docs/tui.md)。

Tauri 2 桌面 spike 位于 `apps/desktop`，只封装现有 Workbench，不新增 Agent 循环、自定义 Rust command 或 Tauri plugin。`bun run doctor:desktop` 静态校验零权限 capability、CSP、loopback 开发地址和 Workbench 构建；Tauri Schema、Cargo 和图标由真实 `desktop:build` 验证。Windows 本机构建需进入 MSVC 开发环境后运行该命令。当前只验证了不打安装包的 Windows 可执行文件，签名、自动更新和 macOS/Linux 仍不在已验收范围。完整说明见 [桌面壳说明](docs/desktop.md)。

客户端基准使用规范化任务定义的 SHA-256，而不是要求 CodeArts 与 OpenCode 复用同一个 Task ID。运行 `bun run benchmark -- report definition.json codearts.record.json opencode.record.json --out report.md` 可校验记录并生成对比；只有两端都完成时才允许比较工作流质量。

运行 `bun run benchmark -- capture definition.json metadata.json --task-id TASK_ID [--mcp-audit AUDIT.json] --out record.json` 可从 Relay 分页捕获 Task 与完整保留期 RunEvent，校验连续 sequence、Task/Run 终态和定义 Prompt/语言，再生成同一严格 record。`metadata.json` 必须显式提供客户端版本、人工干预与失败分类；未提供 audit 时工具摘要也由人工如实填写，绝不从事件数猜测。配置 `GAMEFORGE_MCP_AUDIT_DIR` 后，生产 MCP 每次启动生成唯一、有界的 0600 JSON，只记录工具名/顺序/时间/耗时/状态；CodeArts 认领 Task 后通过条件工具 `bind_mcp_audit_context` 一次性绑定 Task/Run，相同绑定幂等、不同绑定拒绝。显式导入 audit 后，capture 必须与 Relay 交叉核对绑定，再机械计算工具摘要并写入 Task/Run、session ID 与 SHA-256。两种证据都不包含 Prompt、参数、返回值、日志正文、URL 或 TTS job handle。输出文件必须不存在，防止覆盖既有证据。

## 集成边界

GameForge 核心不实现为 OpenCode Plugin。核心由客户端无关的 contracts、Provider 适配器、生成器、Asset Store、Verifier、Run Relay 和确定性 MCP 组成；CodeArts 与 OpenCode 只是可替换的主智能体/宿主。

- `AGENTS.md`：规则；
- `.codeartsdoer/skills/`：生产流程；
- MCP：确定性工具；
- Workbench/TUI：状态界面；
- OpenCode Plugin：可选的可用性检测、会话提示、状态工具和通知。

可提交的 [`opencode.json.example`](opencode.json.example) 不包含绝对路径或密钥。复制为本地配置前设置 `GAMEFORGE_PROJECT_OUTPUT_ROOT` 和 `GAMEFORGE_RUN_RELAY_URL`；权限默认让校验/查询类工具直接执行，让项目生成、资产导入、预览启停和 Run 终态操作请求确认。跨平台动态启动器见 `integrations/`。

Workbench 的 iframe、CSP、预览 origin allowlist 与未来桌面壳最小权限见 [Workbench 安全边界](docs/workbench-security.md)。远程预览必须在 `VITE_GAME_PREVIEW_ORIGINS` 中显式列出；任何 Provider 密钥都不得放入浏览器可见的 `VITE_*` 环境变量。

仓库统一使用 Bun 1.3.14 或更高版本和 `bun.lock`；仓库级 `.npmrc` 固定 npm 官方 registry，以确保 Phaser 4.2.1 与安全审计元数据可复现。不要再生成或提交 npm、pnpm、Yarn 的并行锁文件。

启用阿里云百炼 Qwen 的结构化 GameSpec 草拟工具时，在启动 MCP 服务的进程环境中设置：

```text
DASHSCOPE_API_KEY=<阿里云百炼 API key>
GAMEFORGE_SPEC_MODEL=qwen3.6-flash
```

`GAMEFORGE_SPEC_MODEL` 可省略，默认使用 `qwen3.6-flash`。只有设置 `DASHSCOPE_API_KEY` 时，MCP 才注册 `draft_game_spec`；该工具通过百炼官方 OpenAI 兼容接口发起一次非流式请求，要求严格 JSON Schema 输出，并再次按仓库 `GameSpec` Schema 校验。密钥只从服务端环境读取，不进入工具参数、日志或仓库。

`get_gameforge_capabilities` 始终注册，返回本次 MCP 进程实际可用的国产模型、媒体和工程能力布尔快照，不返回密钥、Token、主机白名单或本机路径。CodeArts 将它发布为 `capabilities.ready` 后，Workbench 才把对应 Provider 标记为“本次 MCP 已配置”；未收到事件时显示等待，完整依赖链缺一项时显示未配置。

Provider HTTP 适配器统一使用有界超时和结构化错误。百炼、Freesound GET 与 TTS 查询/下载可对 408、429、5xx、超时和网络错误最多尝试三次；认证、授权和普通请求错误立即失败。Seedream 生图与 TTS submit 默认只发送一次，因为官方没有可核验的幂等保证，避免模糊网络失败造成重复计费任务。完整依据与边界见 [国产模型与游戏媒体资产策略](docs/model-media-strategy.md)。

当前国产 SOTA、Artificial Analysis/LMArena/OpenCompass、SWE-bench/Terminal-Bench、视觉/生图/TTS 榜单和 oh-my-opencode 改名状态的交叉评估见 [2026-07 模型评估](docs/model-evaluation-2026-07.md)。榜单只作为先验；宿主实际模型列表与 GameForge 同 Task 证据优先。

[`config/model-routing.example.json`](config/model-routing.example.json) 是无密钥的国产模型角色/类别路由建议，并由 `modelRoutingPolicySchema` 与集成测试验证。当前 CodeArts 账号真实列出的 DeepSeek V3.2/GLM 系列优先用于主 Agent；Kimi K3 用于宿主确实提供时的长上下文、视觉和跨宿主评估；Qwen GameSpec、Seedream、豆包 TTS 与 Freesound 仍位于确定性 MCP 工具侧。配置中的期望模型不能替代宿主 `models` 输出，实验必须记录实际生效模型。

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

图片、Freesound preview 和已完成的 TTS 素材都支持显式替换：先读取 Manifest，再对同一 `assetId` 传入 `mode: "replace"` 与当前 `expectedRevision`。Asset Store 会在锁内再次执行 revision CAS、校验旧文件哈希并切换文件与 Manifest；成功后 revision 增加且仍发布 `asset.ready`。明显 stale 的图片/音效替换会在云 Provider 调用前拒绝，TTS 会先本地验签提取 assetId。替换不会按角色猜测目标，也不会覆盖未纳入 Manifest 的现有文件。

首次创建和替换都会在任何临时媒体写入前创建 0600 的 `.gameforge/assets.transaction.json`。若 MCP 进程在切换中途终止，`recover_project_assets` 会在写锁内验证日志、Manifest revision/规范哈希和媒体哈希：旧 Manifest 仍权威时删除属于未提交 create 的孤儿，或回滚 replace；新 Manifest 已权威时完成清理。未知版本、第三种状态或任何哈希冲突均保守拒绝。该工具不调用云 Provider，OpenCode 权限继承未匹配 `gameforge_*` 的默认 `ask`。

Asset Store 的互斥锁包含 0600 owner metadata。MCP 崩溃遗留的锁只有在 metadata 完整、hostname 与当前机器一致、PID 明确不存在且创建时间超过 10 分钟时才自动恢复；活进程、近期锁、异地主机、空锁或旧格式一律保守拒绝。不要用脚本无条件删除 `.gameforge/assets.lock`。

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

Relay CLI 固定监听 `127.0.0.1`。需要为同机其他进程增加纵深防护时，可在 Relay、MCP、TUI、benchmark 和 OpenCode Plugin 的进程环境中设置同一个至少 32 字符的 `GAMEFORGE_RUN_RELAY_TOKEN`；配置后除 CORS 预检外所有 Task、Run、回放和 SSE 路由都要求 Bearer，token 不进入 URL、日志或 record。Workbench 不读取该变量，也不得把它放进 `VITE_*`；带认证的远程浏览器部署必须由同源认证反向代理处理。CORS/Origin 不是身份认证，导出的 `createRunRelayServer` 若被嵌入到非 loopback 监听必须显式配置 `authToken` 和网络层访问控制。

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

Workbench 的 SSE 出错或出现 sequence 缺口时会关闭旧连接，从最后连续游标执行 Schema 回放，再重建 stream；自动恢复采用 0.5/1/2/4/8 秒有限退避，409/410 游标冲突直接停止。耗尽后界面显示“恢复连接”，由用户从同一游标显式重试。该循环只恢复确定性 RunEvent，不调用模型或 MCP 工具。

Task 创建以 Run ID 作为幂等键：网络响应丢失后，以完全相同的 Run ID、Prompt、语言和可选 `projectId` 重试会返回原 Task 与原始 `run.started`，不会重复排队；同 Run ID 携带不同内容会返回稳定的 `task_run_conflict`。`projectId` 存在时 CodeArts 必须更新该受管项目，不存在时才创建新项目；不得从 Prompt 或目录猜测。一个 Run ID 只代表一次不可变任务，完成新需求时应使用新的 Run ID。

Workbench 可选择 `zh-CN` 或 `en-US`。语言随 Task 进入权威 `run.started`，因此重连与事件回放可以恢复选择；CodeArts 必须把 Task 的 Prompt 与 language 原样传给 `draft_game_spec`。百炼返回的 `GameSpec.locale` 不匹配时会被拒绝，生成项目的静态 HTML `lang`、无障碍标签和 Phaser HUD/控制提示均随 locale 输出；旧规格缺少 locale 时仍默认中文。

Workbench 会为每次页面会话准备唯一 Run ID；连接期间输入锁定。若提交响应不确定，直接保留当前 ID 和项目选择重试；若要开始不同需求，先停止或等待当前 Run 终止，再点击“新任务”显式轮换 ID。不要手工修改已连接 Run 的 ID。

Workbench 的“Task 历史”只读获取 Relay 最近 20 项。选择后会清空当前 UI 投影，并从该 Task 的 Run sequence 0 权威回放 Prompt、语言、项目选择和 RunEvent；它不会重新认领 Task、修改旧 Run 或自动停止正在后台执行的 Run。持久化历史仍取决于 Relay 是否配置 `GAMEFORGE_RUN_RELAY_STATE_FILE`。

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
