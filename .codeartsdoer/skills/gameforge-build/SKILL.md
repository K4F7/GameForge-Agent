---
name: gameforge-build
description: 使用 GameForge 的确定性 MCP 工具，由 CodeArts 主智能体完成小游戏的规格化、生成、素材接入、验证与实验记录。
---

# GameForge Build

当用户要求制作、修改或验证浏览器小游戏时使用本技能。CodeArts 始终负责理解、规划、代码修改和修复判断；MCP 工具只执行一次确定性操作。

## 前置检查

1. 阅读 `AGENTS.md`、相关设计文档和即将修改的代码。
2. 列出 MCP 当前实际注册的工具；未注册的媒体工具视为未配置，不猜测密钥。调用一次 `get_gameforge_capabilities` 获取不含密钥的实际适配器快照，工具列表只用于确认可调用性，snapshot 才是 Provider 选择的权威来源。
3. 明确验收条件：可构建、可运行、核心玩法可完成、失败条件有效、素材来源可审计。Run 建立或恢复后，若回放中尚无 `capabilities.ready`，将 capability snapshot 原样发布为下一条连续事件；只使用其中 `ready: true` 的可选 Provider。
4. 若 `list_game_tasks` 已注册，调用一次 `{ limit: 20 }` 的无状态过滤快照。优先选择当前用户明确指定的 Task；否则优先恢复 `status: "claimed"` 且 `claimedBy: "codearts"` 的相关任务，再选择 `queued` 任务。存在多个无法从当前 Run ID、Prompt 或用户上下文消歧的候选时请求用户选择，不猜测。无论恢复还是首次处理，都以 `agentId: "codearts"` 调用 `claim_game_task`；同一 agent 重复认领是幂等操作。将返回的 `prompt` 和 `runId` 作为权威输入。Workbench 创建 Task 时已经原子创建 Run，因此不得再次调用 `create_game_run`。随后调用一次 `replay_game_run`（`after: 0`）恢复该 Run 的权威事件与最后 sequence；若返回正好 1000 项，按最后 sequence 再读取下一页，直到不足 1000 项，禁止轮询等待新事件。恢复任务时根据已有 `phase.completed`、`spec.ready`、`asset.ready` 和 `preview.ready` 跳过已完成的有副作用步骤，从下一未完成阶段继续。若项目已生成且 `get_project_assets` 已注册，调用一次读取权威 Manifest；若它明确报告未完成的资产事务，且 `recover_project_assets` 已注册，经用户/客户端 `ask` 确认后调用一次，再重新读取 Manifest。恢复工具只在写锁内按严格日志完成清理或回滚，不调用 Provider；未知日志、第三种 Manifest 状态或哈希冲突必须停止并请求人工检查。将 Manifest 中尚无对应 `asset.ready` 的 entry 以当前 `revision` 逐条补发为连续事件，再决定是否调用媒体 Provider。这样可恢复“文件已落盘、事件未发布”与“替换切换中断”，不得因 Relay 缺事件就重复下载或生成已有 asset ID/role。若没有收件箱任务，则创建唯一实验编号和 run ID，调用 `create_game_run` 并保存 sequence 游标。禁止在 Skill 或 MCP 内循环轮询任务。

5. 认领 Task 后，将返回的 `taskId`、`prompt` 和 `runId` 作为权威输入。若 `bind_mcp_audit_context` 已注册，经客户端 `ask` 确认后立即以该 `taskId`/`runId` 调用一次，再开始回放和生产步骤；相同绑定可幂等恢复，绑定失败或报告其他 Task/Run 时停止并请求人工检查，不能换审计文件伪造归属。未注册该工具时继续正常流程，但基准记录的工具历史必须保持 unknown。

## 工作流

资产事务恢复同时覆盖首次创建与替换；不得把 create 中断留下的哈希匹配孤儿当作可忽略文件，也不得绕过 `recover_project_assets` 手工删除。

1. 使用已认领 Task 的 `prompt` 和 `language`（或当前直接用户需求与明确语言）。若 `draft_game_spec` 已注册，优先把两者原样传入，转换为一次结构化 GameSpec 草案；Task 为 `zh-CN` 时 GameSpec `locale` 必须是 `zh-CN`，Task 为 `en-US` 时必须是 `en-US`。随后始终调用 `validate_game_spec`。若工具未注册，CodeArts 自行整理 GameSpec 并显式设置同一 `locale`；校验失败时由 CodeArts 修改输入后再次调用。验证成功后，将返回的规格原样发布为下一条连续的 `spec.ready` RunEvent，供 Workbench 展示；`draft_game_spec` 只发起一次百炼 Qwen 请求，不负责规划、重试或修复。
2. 以认领返回的 Task 为项目选择权威来源，不从 Prompt、目录或旧 Run 事件猜测。Task 含 `projectId` 时必须对该 ID 调用 `generate_game_project` 的 `operation: "update"` dry-run，审阅 `updatedPaths`、`preservedPaths`、`deletedPaths` 和 `conflicts`；只有 conflicts 为空并经用户/客户端 `ask` 确认后，才以相同 spec、`mode: "apply"` 和 dry-run 返回的 `currentPlanSha256` 作为 `expectedPlanSha256` 执行。Task 不含 `projectId` 时才走默认 create `dry-run`，审阅文件计划并确认目标为空后 apply。update 只覆盖旧 Manifest 拥有且哈希未变的文件，保留运行时资产 Manifest、`bun.lock` 和未知用户文件；不存在 force 模式。冲突时由 CodeArts 亲自审阅/合并用户代码，不绕过保护。
   若 update dry-run/apply 报告未完成的项目更新事务，且 `recover_game_project_update` 已注册，经用户/客户端 `ask` 确认后只调用一次。该工具在 update lock 内按旧/新托管 Manifest 哈希回滚或完成清理，不调用模型、Provider、Relay 或代码修复；返回后必须重新 dry-run，不能沿用中断前的 plan CAS。未知日志、第三种 Manifest 状态或文件哈希冲突必须停止并请求人工检查。
3. 默认使用 Phaser、Vite 与程序化占位素材。仅在工具已注册且需求需要时：
   - `request_image_asset`：一次 Seedream 官方 API 请求并安全落盘；只选择 `player`、`collectible`、`hazard` 或 `background` 图片角色，语音和音频角色不会进入该工具 Schema；
   - `search_sound_asset`：一个 Freesound 官方搜索操作，默认 CC0；只读 HTTP 遇到明确瞬时故障时可做传输层有限退避；
   - `import_sound_asset`：一个预览导入操作并记录许可、署名和哈希；只读下载可做传输层有限退避，短音效使用 `collect-sound`/`hit-sound`，明确选作背景音乐的候选使用 `bgm`，工具会将后者记录为 `music`；
   - `submit_voice_job`：提交一次火山长文本 TTS 作业；
   - `query_voice_job`：查询一次带签名且绑定项目的作业；
   - `materialize_voice_job`：成功后查询一次、下载一次并写入 `voice` 角色。
   `submit_voice_job` 返回后，立即把 `projectId`、`assetId`、原样 `jobHandle` 和 `status` 发布为下一条连续的 `voice.job.updated`；每次 `query_voice_job` 返回后用同一 project/asset/handle 发布新的 `voice.job.updated`。不要把 handle 写入普通日志。恢复 Task 时按 projectId + assetId 取 sequence 最新的 voice job 事件：`processing` 时由 CodeArts 决定何时单次 query，`succeeded` 时可直接 materialize，`failed` 时保留证据并决定回退，不自动重新提交。
   每次媒体落盘工具返回 `entry` 和 `manifestRevision` 后，将其与项目 ID 原样发布为下一条连续的 `asset.ready` RunEvent；不要从日志文本重建条目，也不要发布尚未落盘的候选素材。
   若浏览器验收或用户反馈要求替换已有素材，先调用一次 `get_project_assets`，按明确的 `assetId` 找到目标并记录当前 `revision`；不得只凭角色猜测替换目标。随后对同一个媒体落盘工具设置 `mode: "replace"` 和 `expectedRevision: <当前 revision>`。图片和 Freesound 工具会在调用 Provider 前预检 revision 与 assetId；TTS 素材化会先在本地验签并读取 job 中的 assetId，再预检，均不会在明显 stale 时产生云调用或下载。成功后仍把返回的新 `entry` 与新 `manifestRevision` 发布为连续 `asset.ready`，并刷新现有预览以重新读取 Manifest。revision 冲突时重新读取一次 Manifest 并由 CodeArts 判断，不盲目重试 Provider；`create` 是默认模式，禁止用 replace 绕过未知资产或角色冲突。
   TTS 查询间隔由 CodeArts 判断，禁止在 MCP 内部轮询。
4. CodeArts 亲自修改玩法代码；不要让 MCP 工具实现 Agent 循环或任意代码编辑。
5. 每个阶段发布连续的阶段、日志和结构化产物事件（`spec.ready`、`asset.ready`、`preview.ready`）。若游标冲突，调用一次 `replay_game_run` 从已知游标读取服务端状态，再由 CodeArts 决定；不在客户端自动重试或轮询。
6. 实际运行项目的类型检查、构建和测试。没有运行的命令不得写成“通过”。
7. 调用 `verify_game_project` 启动生成游戏并执行有上限的操作路径，检查控制台错误、失败请求、Canvas、显式胜负状态和截图。先做 `expectedOutcome: "running"` 的启动烟测；若返回 telemetry，CodeArts 优先依据玩家、剩余目标和危险物世界坐标设计有限动作，再验证 `won` 或 `lost`，不要用缩放截图猜坐标。每次工具返回完整报告后，发布下一条 `verification.ready`：原样使用 projectId、passed、state 中的 outcome/score/lives/remainingSeconds、evidencePath、canvas、actionsExecuted、durationMs，并将三类诊断数组分别转换为数量；不要把绝对 screenshotPath 或诊断全文写入事件。恢复时使用 sequence 最新的验收事件判断是否需要继续验证或修复。工具内部不得规划动作或修复代码。浏览器能力不可用时，明确标记“视觉验收未完成”。
8. 验收通过后调用 `start_game_preview`，将工具返回的 `projectId` 和 `url` 原样写入下一条连续的 `preview.ready` RunEvent，使 Workbench 切换到本次生成项目。不要自行拼接路径或发布未经过工具/契约验证的 URL。替换项目、用户明确关闭预览或会话不再需要时调用 `stop_game_preview`；完成运行时可保留预览供用户检查。
9. 修复次数默认上限为 2 轮；超过后保留错误证据并请求人工判断。
10. 全部验收通过后调用 `complete_game_run`；用户停止或无法安全继续时调用 `stop_game_run`。

## 资产边界

- 资产只能写入生成项目的 `public/assets/`，并同步更新 `public/assets/manifest.json`。
- 不把 API key、token、账号或本地环境写入参数、日志、清单或仓库。
- CC BY 素材必须保留作者、原始页面与许可；默认排除 BY-NC。
- 生成素材必须记录 provider、model、prompt、license 与 SHA-256。
- 媒体工具失败时继续使用程序化占位素材，不阻断玩法实现。
- 资产替换必须使用 Manifest revision CAS；不直接删除旧文件、不手工编辑 Manifest，也不把同角色的另一个 assetId 当成隐式替换。

## 实验记录

在 `experiments/` 记录：原始任务、GameSpec、模型与 Provider、起止时间、工具调用计数、人工干预、验证命令、实际输出、视觉证据状态和剩余风险。
