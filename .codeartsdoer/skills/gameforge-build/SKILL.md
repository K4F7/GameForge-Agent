---
name: gameforge-build
description: 使用 GameForge 的确定性 MCP 工具，由 CodeArts 主智能体完成 Web 游戏的规格化、生成、素材接入、验证与实验记录。
---

# GameForge Build

当用户要求制作、修改或验证 Web 游戏时使用本技能。Web 游戏固定使用 Phaser 与 Vite。CodeArts 始终负责理解、规划、代码修改和修复判断；MCP 工具只执行一次确定性操作。

## 前置检查

1. 阅读 `AGENTS.md`、相关设计文档和即将修改的代码。
   同时读取 `config/model-routing.example.json` 作为模型角色/类别的默认路由建议。当前生产默认只包含 CodeArts 内置的 DeepSeek/GLM 精确 target；OpenCode、Hy3、Kimi 或其他跨宿主模型只能在用户另行明确授权的独立实验中作为显式 override，不能进入默认 fallback。先以宿主实际 `models`/capability 输出确认可用性；未列出的模型不得声称已使用。若 `get_agent_model_route` 已注册，把本次工种和宿主真实列出的国产 target 传入一次，以工具返回的 `selected` 结果选择模型；每个 target 必须是 `{provider, mode, model, capabilities}` 对象，model 保持宿主精确 ID，不能把 JSON 字符串、网关名或显示名冒充 Provider。`unavailable` 或 `planned` 必须显式报告，不能静默伪装成 primary。Agent 路由仍由 CodeArts 负责，该工具只解析策略，不调用模型或运行 Agent 循环。用户显式覆盖优先，并在实验记录中写返回的 source 与实际生效模型。
2. 列出 MCP 当前实际注册的工具；未注册的媒体工具视为未配置，不猜测密钥。调用一次 `get_gameforge_capabilities` 获取不含密钥的实际适配器快照，工具列表只用于确认可调用性，snapshot 才是 Provider 选择的权威来源。
3. 明确验收条件：可构建、可运行、核心玩法可完成、失败条件有效、素材来源可审计。Run 建立或恢复后，若回放中尚无 `capabilities.ready`，将 capability snapshot 原样发布为下一条连续事件；只使用其中 `ready: true` 的可选 Provider。
4. 若 `list_game_tasks` 已注册，调用一次 `{ limit: 20 }` 的无状态过滤快照。优先选择当前用户明确指定的 Task；否则优先恢复 `claimedBy: "codearts"` 且 `status` 为 `in-progress` 或 `claimed` 的相关任务（`in-progress` 优先），再选择与当前用户需求明确匹配的 `queued` 任务。不得为了省事认领无关 queued Task；存在多个无法从当前 Run ID、Prompt 或用户上下文消歧的候选时请求用户选择，不猜测。
   当前用户明确要求开始一个新任务且没有匹配 Task 时，若 `create_game_task` 已注册，经用户/客户端 `ask` 确认后生成一个新的唯一 run ID，并以用户原始 Prompt、明确的 `zh-CN`/`en-US` language 和可选 `projectId` 调用一次。保存完整请求；响应丢失时只允许用完全相同的 run ID、Prompt、language 和 projectId 重试，`task_run_conflict` 必须停止并报告，不能自动更换 ID 掩盖冲突。该工具原子创建 queued Task 与唯一 `run.started`，因此成功后不得再调用 `create_game_run`。
   对仍为 `queued` 的 Task，若权威 Prompt 在认领前已明确存在缺失、冲突或依赖假设的需求，调用一次 `transition_game_task` 进入 `needs-info`，reasonCode 固定为 `{ "schemaVersion": "1.0", "code": "requirements-ambiguous" }`，然后停止生产并请求用户澄清；不得先认领再用消息文本表达歧义。否则以 `agentId: "codearts"` 调用 `claim_game_task`；同一 agent 对自己持有的 `claimed` 或 `in-progress` Task 重复调用也是幂等恢复操作，其他 agent 不得接管。将返回的 `taskId`、`prompt`、`language`、`runId` 和可选 `projectId` 作为权威输入。返回状态为 `claimed` 且尚无冻结契约时，先从已确认的公共验收条件编译版本化 criteria，并调用一次 `freeze_task_acceptance_contract`；返回 `needs-info` 时立即停止并请求澄清，只有返回 `frozen` 后才允许继续。随后仅当 Task 仍为 `claimed` 时以 `agentId: "codearts"` 调用一次 `transition_game_task` 进入 `in-progress`，返回已是 `in-progress` 时禁止重复 freeze 或 transition。随后调用一次 `replay_game_run`（`after: 0`）恢复该 Run 的权威事件与最后 sequence；若返回正好 1000 项，按最后 sequence 再读取下一页，直到不足 1000 项，禁止轮询等待新事件。恢复任务时根据已有 `phase.completed`、`spec.ready`、`asset.ready` 和 `preview.ready` 跳过已完成的有副作用步骤，从下一未完成阶段继续。若项目已生成且 `get_project_assets` 已注册，调用一次读取权威 Manifest；若它明确报告未完成的资产事务，且 `recover_project_assets` 已注册，经用户/客户端 `ask` 确认后调用一次，再重新读取 Manifest。恢复工具只在写锁内按严格日志完成清理或回滚，不调用 Provider；未知日志、第三种 Manifest 状态或哈希冲突必须停止并请求人工检查。将 Manifest 中尚无对应 `asset.ready` 的 entry 以当前 `revision` 逐条补发为连续事件，再决定是否调用媒体 Provider。这样可恢复“文件已落盘、事件未发布”与“替换切换中断”，不得因 Relay 缺事件就重复下载或生成已有 asset ID/role。若 Task Inbox 或 `create_game_task` 未注册，才创建唯一实验编号和 run ID，调用 `create_game_run` 并保存 sequence 游标；这条兼容路径没有 Task/Attempt ID，只用于旧版 Run 记录；不得调用需要 Authority 标识的生成、Attempt 验收或 Evidence 工具，也不得声称完成本生产流程。禁止在 Skill 或 MCP 内循环轮询任务。

5. 仅在 Task Inbox 路径中，认领、冻结验收并进入 `in-progress` 后，将返回的 `taskId`、`prompt` 和 `runId` 作为权威输入。Task 没有 `projectId` 时，先调用一次 `create_game_project_record`，保存 Authority 返回的 `projectId`；该 Task 仍属于生成器的 create 路径，不得因为刚创建了空的 Authority Project 就改走 update。首次 Attempt 调用 `start_game_attempt` 由 Authority 创建或恢复；只有用户明确要求重试、原 Attempt 已由 Authority 标记为 `incomplete`、Task 仍由 `codearts` 持有且处于 `in-progress` 时，才把该原 `attemptId` 传给 `retry_game_attempt`。保存返回的 `attemptId` 与 `revisionId`；不得从目录、旧事件或模型输出自行构造，也不得对 running、passed 或非活动 Task 旋转 Run。若 `bind_mcp_audit_context` 已注册，经客户端 `ask` 确认后立即以该 `taskId`、当前 `runId` 和 `attemptId` 调用一次，再开始生产步骤；相同绑定可幂等恢复，绑定失败或报告其他 Task/Run/Attempt 时停止并请求人工检查，不能换审计文件伪造归属。验收结束时调用 `get_mcp_audit_summary`，保存其返回的完整有界 `audit` 作为 Evidence 的 MCP Audit，并把带同一 `auditDigest` 的 `auditEvent` 原样作为下一条连续事件发布；不得手工重建、删减或改写会话、时间戳与 Attempt 归属。未注册审计工具时继续正常流程，但基准记录的工具历史必须保持 unknown。

## 工作流

平台规则：唯一主动产品 target 是 `web`，运行时固定为 Phaser 与 Vite。生成、构建、预览和浏览器验收都围绕同一个 Web 项目完成；不从历史事件、旧目录或未注册工具推断其他 target。

资产事务恢复同时覆盖首次创建与替换；不得把 create 中断留下的哈希匹配孤儿当作可忽略文件，也不得绕过 `recover_project_assets` 手工删除。

1. 使用已认领 Task 的 `prompt` 和 `language`（或当前直接用户需求与明确语言）。若 `draft_game_spec` 已注册，优先把两者原样传入，转换为一次结构化 GameSpec 草案；Task 为 `zh-CN` 时 GameSpec `locale` 必须是 `zh-CN`，Task 为 `en-US` 时必须是 `en-US`。随后始终调用 `validate_game_spec`，其 `spec` 参数必须直接传原生 JSON object，禁止 JSON.stringify、代码块或其他字符串封装。若工具未注册，CodeArts 自行整理 GameSpec 并显式设置同一 `locale`；校验失败时由 CodeArts 修改输入后再次调用。验证成功后，将返回的规格原样发布为下一条连续的 `spec.ready` RunEvent，供已授权客户端展示；`draft_game_spec` 只发起一次百炼 Qwen 请求，不负责规划、重试或修复。
2. 以认领返回的 Task 和 Authority 返回的当前 `attemptId`/`revisionId` 为项目选择权威来源，不从 Prompt、目录或旧 Run 事件猜测；每次 `generate_game_project` 都传入这两个标识。新任务显式传 `target: "web"`。Task 含 `projectId` 时必须对该 ID 调用 `generate_game_project` 的 `operation: "update"` dry-run，审阅 `updatedPaths`、`preservedPaths`、`deletedPaths` 和 `conflicts`；只有 conflicts 为空并经用户/客户端 `ask` 确认后，才以相同 spec、target、`mode: "apply"` 和 dry-run 返回的 `currentPlanSha256` 作为 `expectedPlanSha256` 执行。托管项目不能跨 target update。Task 不含 `projectId` 时才走默认 create `dry-run`，审阅文件计划并确认目标为空后 apply；create apply 不接受 `expectedPlanSha256`，dry-run 的 plan hash 只用于审阅，不能误套 update CAS。apply 成功后把工具返回的 `generationEvent` 原样作为下一条连续事件发布，不重建候选或身份字段。update 只覆盖旧 Manifest 拥有且哈希未变的文件，保留运行时资产 Manifest、`bun.lock` 和未知用户文件；不存在 force 模式。冲突时由 CodeArts 亲自审阅/合并用户代码，不绕过保护。
   使用仓库自带 `integrations/codearts` launcher 且未覆盖 `GAMEFORGE_PROJECT_OUTPUT_ROOT` 时，apply 后的受管源码位于仓库相对路径 `.gameforge-validation/integrations/projects/<projectId>/`。CodeArts 后续读取和亲自修改玩法代码必须使用这个相对位置；不得改写 `apps/game`，不得把 `<projectId>/` 猜成仓库根目录，也不得在仓库根另建同名项目。不能把绝对主机路径写入 RunEvent、审计摘要或实验记录。若 launcher 明确覆盖了输出根且相对位置不可确定，停止猜测路径并报告配置缺口。
   若 update dry-run/apply 报告未完成的项目更新事务，且 `recover_game_project_update` 已注册，经用户/客户端 `ask` 确认后只调用一次。该工具在 update lock 内按旧/新托管 Manifest 哈希回滚或完成清理，不调用模型、Provider、Relay 或代码修复；返回后必须重新 dry-run，不能沿用中断前的 plan CAS。未知日志、第三种 Manifest 状态或文件哈希冲突必须停止并请求人工检查。
3. `web` 使用 Phaser、Vite 与程序化占位素材。当前阶段默认只使用 CodeArts 内置文本/代码模型，并保持外部媒体 Provider 未配置；因此使用程序化占位素材。只有用户以后明确启用相应账号级能力、capability snapshot 同时为 ready 且客户端权限确认后，才可调用：
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
5. 每个阶段发布连续的阶段、日志和结构化产物事件（`spec.ready`、`asset.ready`、`verification.ready`、`preview.ready`）。若游标冲突，调用一次 `replay_game_run` 从已知游标读取服务端状态，再由 CodeArts 决定；不在客户端自动重试或轮询。
6. 实际运行项目的类型检查、构建和测试。没有运行的命令不得写成“通过”。
7. 调用 `verify_game_project` 启动生成游戏并执行有上限的操作路径，检查控制台错误、失败请求、Canvas、显式胜负状态和截图。验收当前候选时必须传入 Authority 返回的 `attemptId`、`revisionId` 和冻结契约的 `contractVersion`；缺少任一标识时不得把受管项目烟测当作 Attempt 验收。先用短小的 inline `actions` 做 `expectedOutcome: "running"` 启动烟测；完整 won/lost 路径必须写入受管项目 `.gameforge/verification-scenarios.json`，格式为 `{ "schemaVersion": 1, "scenarios": { "won": [...], "lost": [...] }`，每个数组最多 100 个 `press`/`hold`/`click`/`wait` 动作。随后分别执行有界 won/lost 场景；不得在单次 MCP 参数里手工拼接长 actions JSON，也不得让场景直接篡改测试状态。若返回 telemetry，CodeArts 优先依据玩家、剩余目标、危险物、Boss 和出口世界坐标设计有限动作，不要用缩放截图猜坐标。工具返回完整报告后，把其中的 `verificationEvent` 原样作为下一条连续事件发布；该事件已经携带 Attempt/Revision、诊断、build 和 versions 证明，不得由调用方重建、删减或改写。不要把绝对 screenshotPath 写入事件。恢复时使用 sequence 最新的验收事件判断是否需要继续验证或修复。工具内部不得规划动作或修复代码。浏览器能力不可用时，明确标记“视觉验收未完成”。
8. 验收通过后调用 `start_game_preview`，将工具返回的 `projectId` 和 `url` 原样写入下一条连续的 `preview.ready` RunEvent，供验收控制器和其他已授权客户端定位本次生成项目。不要自行拼接路径或发布未经过工具/契约验证的 URL。替换项目、用户明确关闭预览或会话不再需要时调用 `stop_game_preview`；完成运行时可保留预览供用户检查。
9. 修复次数默认上限为 2 轮；超过后保留错误证据并请求人工判断。
10. 全部验收通过后、任何终态操作之前，组装并调用一次 `submit_game_attempt_evidence`。只使用本 Attempt 的权威或生产者原样记录：Task 返回的 `prompt` 及其 SHA-256、Task/Run/Attempt/Project/base Revision/candidate Revision/冻结契约标识、当前 CodeArts 精确 target 与客户端版本/实测时长/人工干预、`get_mcp_audit_summary` 返回且与已发布 `auditEvent.auditDigest` 一致的完整有界 MCP Audit、apply `generationEvent.candidate`、最新 `verificationEvent` 的 build/browser/versions 以及原样 `criteria`、和 `replay_game_run` 得到的完整连续 Authority 历史；不得从文本日志重建、把别的 Attempt 记录改写标识后混入，亦不得在这里实现 Issue #67 的 criterion evaluator。若当前工具没有返回完整持久化 Audit，则该证明视为缺失并按 incomplete 提交，禁止从 `auditEvent` 反造带时间戳的调用记录。
    所有数组保持契约上限：criterion results 与 interventions 各最多 100，screenshots 最多 256，MCP calls 最多 10,000，artifact files 和 Authority events 各最多 100,000；回放超过单页时按连续 cursor 分页，但累计不得超过 100,000。超过任一上限、审计被截断或完整 Authority 历史不可取得时只提交有界的现有记录，不绕过 Schema 或删改已存在证明来伪装完整。
    `submit_game_attempt_evidence` 返回 `sealed` 后，本 Issue 只允许继续现有 Run/Task 收尾，不执行 Issue #69 promotion：先调用 `complete_game_run`，再以 `agentId: "codearts"` 调用 `transition_game_task` 进入 `completed`。返回 `incomplete` 时必须核对稳定 reasonCode `evidence.missing-required-proof.v1`，报告缺失证明并保留不可变 incomplete Attempt；不得调用 `complete_game_run` 或把 Task 声称为 completed，后续只能由用户明确请求 `retry_game_attempt`。若提交因现有证明畸形、关联矛盾或完整性错误而被拒绝，Authority 中 Attempt 保持 `running`；停止收尾并报告具体缺口，修正本 Attempt 的输入后才可再次提交，不得把拒绝降级成 incomplete。
    用户停止时先调用 `stop_game_run`，再以同一 `agentId` 调用 `transition_game_task` 进入 `canceled`、reasonCode 固定为 `{ "schemaVersion": "1.0", "code": "cancellation" }`。失败或无法安全继续时，必须依据 Authority 的版本化 reasonCode 分类：`retryable` 保持 Run 可续接；进入终态 `failed` 前先用 `publish_run_events` 发布不可修复的 `phase.failed`，进入 `conflicted` 前先调用 `stop_game_run`。随后以同一 `agentId` 调用一次 `transition_game_task`；不得从错误消息猜测重试性，也不得在 Skill 或工具内自动重试。未知原因不提交终态，停止并请求人工判断。

## 资产边界

- 资产只能通过 Asset Store 写入受管 Web target 的 `public/assets/` 运行时资源树；Manifest 中的逻辑路径始终保持 `assets/...`，不得由 Agent 自行拼接物理路径。
- 不把 API key、token、账号或本地环境写入参数、日志、清单或仓库。
- CC BY 素材必须保留作者、原始页面与许可；默认排除 BY-NC。
- 生成素材必须记录 provider、model、prompt、license 与 SHA-256。
- 媒体工具失败时继续使用程序化占位素材，不阻断玩法实现。
- 资产替换必须使用 Manifest revision CAS；不直接删除旧文件、不手工编辑 Manifest，也不把同角色的另一个 assetId 当成隐式替换。

## 实验记录

在 `experiments/` 记录：原始任务、GameSpec、模型与 Provider、起止时间、工具调用计数、人工干预、验证命令、实际输出、视觉证据状态和剩余风险。
