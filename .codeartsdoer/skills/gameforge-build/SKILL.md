---
name: gameforge-build
description: 使用 GameForge 的确定性 MCP 工具，由 CodeArts 主智能体完成小游戏的规格化、生成、素材接入、验证与实验记录。
---

# GameForge Build

当用户要求制作、修改或验证抖音、微信或浏览器小游戏时使用本技能。CodeArts 始终负责理解、规划、代码修改和修复判断；MCP 工具只执行一次确定性操作。

## 前置检查

1. 阅读 `AGENTS.md`、相关设计文档和即将修改的代码。
   同时读取 `config/model-routing.example.json` 作为模型角色/类别的默认路由建议。先以宿主实际 `models`/capability 输出确认可用性；未列出的模型不得声称已使用。若 `get_agent_model_route` 已注册，把本次工种和宿主真实列出的国产 target 传入一次，以工具返回的 `selected` 结果选择模型；`unavailable` 或 `planned` 必须显式报告，不能静默伪装成 primary。Agent 路由仍由 CodeArts 负责，该工具只解析策略，不调用模型或运行 Agent 循环。用户显式覆盖优先，并在实验记录中写返回的 source 与实际生效模型。
2. 列出 MCP 当前实际注册的工具；未注册的媒体工具视为未配置，不猜测密钥。调用一次 `get_gameforge_capabilities` 获取不含密钥的实际适配器快照，工具列表只用于确认可调用性，snapshot 才是 Provider 选择的权威来源。
3. 明确验收条件：可构建、可运行、核心玩法可完成、失败条件有效、素材来源可审计。Run 建立或恢复后，若回放中尚无 `capabilities.ready`，将 capability snapshot 原样发布为下一条连续事件；只使用其中 `ready: true` 的可选 Provider。
4. 若 `list_game_tasks` 已注册，调用一次 `{ limit: 20 }` 的无状态过滤快照。优先选择当前用户明确指定的 Task；否则优先恢复 `status: "claimed"` 且 `claimedBy: "codearts"` 的相关任务，再选择与当前用户需求明确匹配的 `queued` 任务。不得为了省事认领无关 queued Task；存在多个无法从当前 Run ID、Prompt 或用户上下文消歧的候选时请求用户选择，不猜测。
   当前用户明确要求开始一个新任务且没有匹配 Task 时，若 `create_game_task` 已注册，经用户/客户端 `ask` 确认后生成一个新的唯一 run ID，并以用户原始 Prompt、明确的 `zh-CN`/`en-US` language 和可选 `projectId` 调用一次。保存完整请求；响应丢失时只允许用完全相同的 run ID、Prompt、language 和 projectId 重试，`task_run_conflict` 必须停止并报告，不能自动更换 ID 掩盖冲突。该工具原子创建 queued Task 与唯一 `run.started`，因此成功后不得再调用 `create_game_run`。
   无论 Task 来自 Workbench、TUI、`create_game_task` 还是恢复，都以 `agentId: "codearts"` 调用 `claim_game_task`；同一 agent 重复认领是幂等操作。将返回的 `taskId`、`prompt`、`language`、`runId` 和可选 `projectId` 作为权威输入。随后调用一次 `replay_game_run`（`after: 0`）恢复该 Run 的权威事件与最后 sequence；若返回正好 1000 项，按最后 sequence 再读取下一页，直到不足 1000 项，禁止轮询等待新事件。恢复任务时根据已有 `phase.completed`、`spec.ready`、`asset.ready` 和 `preview.ready` 跳过已完成的有副作用步骤，从下一未完成阶段继续。若项目已生成且 `get_project_assets` 已注册，调用一次读取权威 Manifest；若它明确报告未完成的资产事务，且 `recover_project_assets` 已注册，经用户/客户端 `ask` 确认后调用一次，再重新读取 Manifest。恢复工具只在写锁内按严格日志完成清理或回滚，不调用 Provider；未知日志、第三种 Manifest 状态或哈希冲突必须停止并请求人工检查。将 Manifest 中尚无对应 `asset.ready` 的 entry 以当前 `revision` 逐条补发为连续事件，再决定是否调用媒体 Provider。这样可恢复“文件已落盘、事件未发布”与“替换切换中断”，不得因 Relay 缺事件就重复下载或生成已有 asset ID/role。若 Task Inbox 或 `create_game_task` 未注册，才创建唯一实验编号和 run ID，调用 `create_game_run` 并保存 sequence 游标；这条兼容路径没有 Task ID，必须在实验记录中明确。禁止在 Skill 或 MCP 内循环轮询任务。

5. 认领 Task 后，将返回的 `taskId`、`prompt` 和 `runId` 作为权威输入。若 `bind_mcp_audit_context` 已注册，经客户端 `ask` 确认后立即以该 `taskId`/`runId` 调用一次，再开始回放和生产步骤；相同绑定可幂等恢复，绑定失败或报告其他 Task/Run 时停止并请求人工检查，不能换审计文件伪造归属。未注册该工具时继续正常流程，但基准记录的工具历史必须保持 unknown。

## 工作流

平台规则：V1 未指定平台时仍默认 `douyin-mini-game`；用户明确要求微信小游戏时必须使用 `wechat-mini-game`，明确要求浏览器参考版时才使用 `web`。抖音与微信均复用五种 LayaAir 玩法源工程；完成媒体落盘后按 target 分别调用一次 `build_douyin_mini_game`（`bytedancegame`）或 `build_wechat_mini_game`（`wxgame`），并发布工具原样返回的无路径 `buildEvent`。两种工具都只做本地构建和静态校验，不登录、预览、上传或发布；DevTool 与真机证据必须另行记录。

小游戏逻辑验收：若 `verify_minigame_gameplay` 已注册，在当前 target 源工程生成且受管文件无修改后调用一次，将返回的 `gameplayEvent` 补齐 Run envelope 并发布为连续 `gameplay.verified`。该工具只执行与 Manifest 哈希一致的固定 Laya 模板，在可控时钟/输入中分别证明 genre 胜利和超时失败；模板或 GameSpec 哈希不一致必须停止并由 CodeArts审阅，不能绕过。该事件不含 Canvas、截图或证据路径，Workbench/TUI 必须显示“无渲染逻辑证据”，不得替代平台 build、DevTool 或真机验收。

资产事务恢复同时覆盖首次创建与替换；不得把 create 中断留下的哈希匹配孤儿当作可忽略文件，也不得绕过 `recover_project_assets` 手工删除。

1. 使用已认领 Task 的 `prompt` 和 `language`（或当前直接用户需求与明确语言）。若 `draft_game_spec` 已注册，优先把两者原样传入，转换为一次结构化 GameSpec 草案；Task 为 `zh-CN` 时 GameSpec `locale` 必须是 `zh-CN`，Task 为 `en-US` 时必须是 `en-US`。随后始终调用 `validate_game_spec`。若工具未注册，CodeArts 自行整理 GameSpec 并显式设置同一 `locale`；校验失败时由 CodeArts 修改输入后再次调用。验证成功后，将返回的规格原样发布为下一条连续的 `spec.ready` RunEvent，供 Workbench 展示；`draft_game_spec` 只发起一次百炼 Qwen 请求，不负责规划、重试或修复。
2. 以认领返回的 Task 为项目选择权威来源，不从 Prompt、目录或旧 Run 事件猜测。V1 新小游戏任务显式传 `target: "douyin-mini-game"`；只有用户明确要求浏览器参考版时才用 `web`。抖音 target 支持 `arcade`、`platformer`、`puzzle`、`shooter`、`strategy` 五种已通过官方 LayaAir 编译的基线，必须保持 GameSpec 原 genre，不能静默换模板。Task 含 `projectId` 时必须对该 ID 调用 `generate_game_project` 的 `operation: "update"` dry-run，审阅 `updatedPaths`、`preservedPaths`、`deletedPaths` 和 `conflicts`；只有 conflicts 为空并经用户/客户端 `ask` 确认后，才以相同 spec、target、`mode: "apply"` 和 dry-run 返回的 `currentPlanSha256` 作为 `expectedPlanSha256` 执行。托管项目不能跨 target update。Task 不含 `projectId` 时才走默认 create `dry-run`，审阅文件计划并确认目标为空后 apply。update 只覆盖旧 Manifest 拥有且哈希未变的文件，保留运行时资产 Manifest、`bun.lock` 和未知用户文件；不存在 force 模式。冲突时由 CodeArts 亲自审阅/合并用户代码，不绕过保护。
   若 update dry-run/apply 报告未完成的项目更新事务，且 `recover_game_project_update` 已注册，经用户/客户端 `ask` 确认后只调用一次。该工具在 update lock 内按旧/新托管 Manifest 哈希回滚或完成清理，不调用模型、Provider、Relay 或代码修复；返回后必须重新 dry-run，不能沿用中断前的 plan CAS。未知日志、第三种 Manifest 状态或文件哈希冲突必须停止并请求人工检查。
3. `web` 默认使用 Phaser、Vite 与程序化占位素材；`douyin-mini-game` 使用生成器固定的 LayaAir 3.4.0 TypeScript 源工程。抖音 apply 和媒体落盘完成后，若 `build_douyin_mini_game` 已注册，只调用一次；成功后取工具返回的无路径 `buildEvent`，只补当前权威 runId、下一 sequence 和 emittedAt，立即作为连续 `build.ready` 发布。MCP 响应本身不返回绝对 `outputPath`，禁止从原始 validation 手工重建已有 payload。恢复时若 sequence 最新的 `build.ready` 对应同一项目、Manifest revision 与当前资产一致，可跳过重复构建，否则重新调用一次。工具内部固定构建目标、超时、日志上限和项目锁，不登录、预览、上传或发布。未注册时报告本地 CLI capability 缺失，不自行拼接 shell 命令。不得用 Chrome `verify_game_project` 冒充平台验收，DevTool/真机仍单独记录。仅在工具已注册且需求需要时：
   - `request_image_asset`：一次 Seedream 官方 API 请求并安全落盘；只选择 `player`、`collectible`、`hazard` 或 `background` 图片角色，语音和音频角色不会进入该工具 Schema；
   - `search_sound_asset`：一个 Freesound 官方搜索操作，默认 CC0；只读 HTTP 遇到明确瞬时故障时可做传输层有限退避；
   - `import_sound_asset`：一个预览导入操作并记录许可、署名和哈希；只读下载可做传输层有限退避，短音效使用 `collect-sound`/`hit-sound`，明确选作背景音乐的候选使用 `bgm`，工具会将后者记录为 `music`；
   - `generate_music_asset`：一次 MiniMax Music 2.6 官方非流式纯音乐请求，以 hex MP3 返回并安全落盘为唯一 `bgm`；生成 POST 默认不自动重试，必须记录账号确认的输出许可；
   - `submit_voice_job`：提交一次火山长文本 TTS 作业；
   - `query_voice_job`：查询一次带签名且绑定项目的作业；
   - `materialize_voice_job`：成功后查询一次、下载一次并写入 `voice` 角色。
   `submit_voice_job` 返回后，立即把 `projectId`、`assetId`、原样 `jobHandle` 和 `status` 发布为下一条连续的 `voice.job.updated`；每次 `query_voice_job` 返回后用同一 project/asset/handle 发布新的 `voice.job.updated`。不要把 handle 写入普通日志。恢复 Task 时按 projectId + assetId 取 sequence 最新的 voice job 事件：`processing` 时由 CodeArts 决定何时单次 query，`succeeded` 时可直接 materialize，`failed` 时保留证据并决定回退，不自动重新提交。
   每次媒体落盘工具返回 `entry` 和 `manifestRevision` 后，将其与项目 ID 原样发布为下一条连续的 `asset.ready` RunEvent；不要从日志文本重建条目，也不要发布尚未落盘的候选素材。
   若浏览器验收或用户反馈要求替换已有素材，先调用一次 `get_project_assets`，按明确的 `assetId` 找到目标并记录当前 `revision`；不得只凭角色猜测替换目标。随后对同一个媒体落盘工具设置 `mode: "replace"` 和 `expectedRevision: <当前 revision>`。图片和 Freesound 工具会在调用 Provider 前预检 revision 与 assetId；TTS 素材化会先在本地验签并读取 job 中的 assetId，再预检，均不会在明显 stale 时产生云调用或下载。成功后仍把返回的新 `entry` 与新 `manifestRevision` 发布为连续 `asset.ready`，并刷新现有预览以重新读取 Manifest。revision 冲突时重新读取一次 Manifest 并由 CodeArts 判断，不盲目重试 Provider；`create` 是默认模式，禁止用 replace 绕过未知资产或角色冲突。
   TTS 查询间隔由 CodeArts 判断，禁止在 MCP 内部轮询。
4. CodeArts 亲自修改玩法代码；不要让 MCP 工具实现 Agent 循环或任意代码编辑。
5. 每个阶段发布连续的阶段、日志和结构化产物事件（`spec.ready`、`asset.ready`、`build.ready`、`preview.ready`）。若游标冲突，调用一次 `replay_game_run` 从已知游标读取服务端状态，再由 CodeArts 决定；不在客户端自动重试或轮询。
6. 实际运行项目的类型检查、构建和测试。没有运行的命令不得写成“通过”。
7. 调用 `verify_game_project` 启动生成游戏并执行有上限的操作路径，检查控制台错误、失败请求、Canvas、显式胜负状态和截图。先做 `expectedOutcome: "running"` 的启动烟测；若返回 telemetry，CodeArts 优先依据玩家、剩余目标和危险物世界坐标设计有限动作，再验证 `won` 或 `lost`，不要用缩放截图猜坐标。每次工具返回完整报告后，发布下一条 `verification.ready`：原样使用 projectId、passed、state 中的 outcome/score/lives/remainingSeconds、evidencePath、canvas、actionsExecuted、durationMs，并将三类诊断数组分别转换为数量；不要把绝对 screenshotPath 或诊断全文写入事件。恢复时使用 sequence 最新的验收事件判断是否需要继续验证或修复。工具内部不得规划动作或修复代码。浏览器能力不可用时，明确标记“视觉验收未完成”。
8. 验收通过后调用 `start_game_preview`，将工具返回的 `projectId` 和 `url` 原样写入下一条连续的 `preview.ready` RunEvent，使 Workbench 切换到本次生成项目。不要自行拼接路径或发布未经过工具/契约验证的 URL。替换项目、用户明确关闭预览或会话不再需要时调用 `stop_game_preview`；完成运行时可保留预览供用户检查。
9. 修复次数默认上限为 2 轮；超过后保留错误证据并请求人工判断。
10. 全部验收通过后调用 `complete_game_run`；用户停止或无法安全继续时调用 `stop_game_run`。

## 资产边界

- 资产只能通过 Asset Store 写入受管 target 的运行时资源树：Web 为 `public/assets/`，抖音与微信 Laya 源工程均为 `assets/resources/assets/`；Manifest 中的逻辑路径始终保持 `assets/...`，不得由 Agent 自行拼接物理路径。
- 不把 API key、token、账号或本地环境写入参数、日志、清单或仓库。
- CC BY 素材必须保留作者、原始页面与许可；默认排除 BY-NC。
- 生成素材必须记录 provider、model、prompt、license 与 SHA-256。
- 媒体工具失败时继续使用程序化占位素材，不阻断玩法实现。
- 资产替换必须使用 Manifest revision CAS；不直接删除旧文件、不手工编辑 Manifest，也不把同角色的另一个 assetId 当成隐式替换。

## 实验记录

在 `experiments/` 记录：原始任务、GameSpec、模型与 Provider、起止时间、工具调用计数、人工干预、验证命令、实际输出、视觉证据状态和剩余风险。
