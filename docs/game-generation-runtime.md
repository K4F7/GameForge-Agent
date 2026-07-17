# 确定性游戏生成与运行事件服务

更新日期：2026-07-16
官方资料访问日期：2026-07-16

## 目标与边界

GameForge把“理解需求”和“生成工程”分开：

1. CodeArts负责理解自然语言、形成GameSpec、选择工具和决定是否修复。
2. `generate_game_project`只把通过Schema的GameSpec填入固定版本模板；它不调用模型、不接受任意代码，也不进行Agent循环。
3. Run Relay只保存任务、回放和推送RunEvent；它不执行任务、不调用Provider，也不替代CodeArts。
4. 工作台把 Prompt 提交到任务收件箱并观察对应 Run；CodeArts 通过 MCP 读取/认领任务，完成后以 `preview.ready` 让工作台切换到本次运行的托管项目。

## 项目生成器

`@gameforge/generator`生成一个独立的Phaser 4 + Vite + TypeScript项目。固定输出包括：

- `game-spec.json`
- `src/main.ts`
- `index.html`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `.gameforge/manifest.json`
- `public/assets/manifest.json`

模板为GameSpec当前五种类型提供基础玩法：

| genre | 基础机制 |
|---|---|
| `arcade` | 俯视角移动、收集、动态危险物 |
| `platformer` | 重力、平台、跳跃、收集与巡逻危险物 |
| `puzzle` | 网格步进、路线规划、收集与避障 |
| `shooter` | 俯视角移动、空格发射、清除危险物 |
| `strategy` | 较慢的指令式移动、状态切换、时间与风险权衡 |

这是供CodeArts继续修改的稳定可玩基线，不声称仅凭GameSpec中几句自然语言就能无损表达任意玩法。

GameSpec 可选 `gameplay` 对象提供四个有界核心参数：`collectibleCount` 1–10、`hazardCount` 0–6、`startingLives` 1–9、`movementSpeed` 100–360 px/s。旧规格缺少该对象时保持各 genre 的 0.2.x 默认值；百炼严格 JSON Schema 要求新草案显式给出四项。生成运行时用它们控制实际出生数量、生命和连续移动速度，platformer 与 arena 均消费同一规格，不只是 Workbench 展示字段。

### 安全策略

- `projectId`只能使用小写字母、数字、点、下划线和连字符，不能提供路径。
- 输出根目录必须由MCP服务端通过绝对路径配置，GameSpec不能修改它。
- 默认`dry-run`只返回排序后的文件列表、字节数和SHA-256。
- `apply`只新建项目，存在同名目录时拒绝；没有覆盖、删除或`force`选项。
- 写入先发生在输出根目录内的随机临时目录，文件使用排他创建并同步，最后同文件系统原子重命名。
- 输出根目录拒绝符号链接；固定文件路径再次经过根目录包含检查。
- GameSpec文本只进入JSON数据文件，不插入可执行TypeScript源码。
- `.gameforge/manifest.json`记录生成器版本、GameSpec哈希、计划哈希和每个托管文件哈希。

### MCP配置

在启动MCP服务前设置绝对路径：

```text
GAMEFORGE_PROJECT_OUTPUT_ROOT=D:\GameForgeGenerated
```

未配置时不注册`generate_game_project`。建议先调用`mode: "dry-run"`审查计划，再以完全相同的`projectId`和GameSpec调用`mode: "apply"`。工具不会接受模型输出的任意文件内容。

同一配置还会注册 `start_game_preview` 和 `stop_game_preview`。预览管理器复用浏览器验收器的受控 Vite 配置，只绑定 `127.0.0.1` 随机端口、固定 Phaser 入口、关闭依赖自动发现，不读取或执行生成项目的 `vite.config.ts`。它先验证真实目录、符号链接边界和 `.gameforge/manifest.json`；默认最多保留 5 个会话，相同项目的并发启动会合并，启动与关闭均有超时。MCP 进程收到 SIGINT/SIGTERM 时关闭所有预览。

生成项目后的验证方式：

```bash
cd <生成目录>/<projectId>
bun install
bun run check
bun run build
bun run dev
```

生成项目固定精确依赖版本、`packageManager: bun@1.3.14` 和 npm 官方 registry，但首次生成时尚无 `bun.lock`，因此第一次使用 `bun install` 创建锁文件；锁文件生成后，自动化环境改用 `bun install --frozen-lockfile`。

## 浏览器验收

`@gameforge/game-verifier` 使用 Vite API 在随机本地端口启动一个生成器托管项目，再通过 Playwright Core 调用系统 Chrome。`verify_game_project` 接受 project ID、最多 100 个 `press`/`hold`/`click`/`wait` 动作、可选期望结果和最长 120 秒超时。Playwright 由 MCP 的 Node runtime 承载；Bun 负责安装和 workspace 脚本，不直接充当 Playwright 浏览器 runtime。

生成器 0.2.0 的真实系统 Chrome 证据现已覆盖 `running`、telemetry 驱动的 `won`，以及通过有界等待让 60 秒倒计时归零的 `lost`。三者均检查 Canvas、显式状态、console/page/request 诊断和截图；lost 截图与结构化报告记录在 `experiments/2026-07-16-browser-telemetry/`。

生成器 0.2.1 修复了统一终态处理未刷新 HUD 的问题：`finish()` 先同步分数、生命和倒计时，再发布终态并绘制遮罩。全新 30 秒样例经独立 Bun 安装/检查/构建和真实 Chrome lost 验收，结构化状态与 HUD 均为 0 秒。

生成器 0.3.0 新增 GameSpec `gameplay` 调优。真实 Chrome 参数样例证明 2 个收集物、0 个危险物、1 条生命和 300 px/s 连续移动均进入运行时 telemetry；证据见 `experiments/2026-07-17-gameplay-tuning/`。0.4.0 进一步校验浏览器实际消费的 Manifest 条目，并补齐 `bgm` 运行时绑定。0.5.0 将玩家和危险物的显示与碰撞体固定为 32×32、收集物固定为 24×24，避免 Seedream 大尺寸源图直接改变玩法尺度。

验收过程只允许访问本次本地 Vite origin，阻断其他网络请求；收集浏览器控制台错误、页面异常和失败请求。就绪条件不是“Canvas 节点已插入”，而是运行时已经发布 telemetry，Canvas 同时具有内部尺寸、可见布局尺寸且未被 CSS 隐藏。Phaser WebGL 默认 framebuffer 在合成后可能无法通过 2D Canvas 稳定读回，因此不再把像素 readback 当作 ready 条件；随后仍检查结构化状态和 Canvas 尺寸，并强制将 PNG 证据写入 `.gameforge/verification/` 供视觉检查。报告只有在诊断为空且显式结果符合预期时才为 `passed: true`。报告同时返回项目内相对 `evidencePath`，CodeArts 将非敏感摘要发布为 `verification.ready`；事件记录 outcome、状态数值、Canvas、诊断计数、动作数、耗时和相对证据路径，不暴露绝对本机路径或诊断全文。工具不设计动作、不重试、不修改代码，动作规划与失败后的修复仍由 CodeArts 负责。

实现依据（访问日期 2026-07-16）：Playwright 官方 [`BrowserType.launch`](https://playwright.dev/docs/api/class-browsertype#browser-type-launch) 文档确认可用 `channel: "chrome"` 调用品牌 Chrome；[Network](https://playwright.dev/docs/network) 文档提供 `page.route()` 与 `route.abort()` 拦截请求，并建议在需要完整路由可见性时阻止 Service Worker；[Screenshots](https://playwright.dev/docs/screenshots) 文档提供 `page.screenshot()` 与整页截图。依赖固定为 `playwright-core@1.61.1`，不在安装阶段下载浏览器。

## Run Relay

除阶段、日志和终态事件外，RunEvent 还支持：

```json
{
  "type": "preview.ready",
  "runId": "run-20260716-1",
  "sequence": 18,
  "emittedAt": "2026-07-16T16:50:00+08:00",
  "projectId": "safety-sprint",
  "url": "http://127.0.0.1:5173/"
}
```

URL 契约只允许 HTTPS，或主机严格为 `localhost`、`127.0.0.1`、`[::1]` 的 HTTP；拒绝凭据、fragment、`file:` 和公网明文 HTTP。CodeArts 应原样发布 `start_game_preview` 的结果，不自行猜测 URL。Relay 仍只验证、保存和转发事件，不启动预览也不执行 Agent 逻辑。

结构化工作台产物使用以下事件：

- `capabilities.ready`：携带本次 MCP 实际注册能力的无密钥快照；Provider `ready` 只有在其完整调用链可用时为 true；
- `spec.ready`：携带完整 GameSpec，并再次经过 `gameSpecSchema`；
- `asset.ready`：携带项目 ID、正整数 manifest revision 和一个完整 `runtimeAssetEntrySchema` 条目。
- `voice.job.updated`：携带项目 ID、asset ID、签名异步作业 handle 与 processing/succeeded/failed；用于 CodeArts 中断恢复，不写入普通日志。
- `verification.ready`：携带一次浏览器验收的有界摘要和项目内 PNG 路径；用于会话恢复和 Workbench 验收卡，不携带绝对路径或诊断全文。

CodeArts 在 `validate_game_spec` 成功后发布 `spec.ready`；图片、音效或配音工具真正完成安全落盘后，原样使用返回的 `entry` 与 `manifestRevision` 发布 `asset.ready`。候选搜索结果、纯日志和未写入文件的 Provider 响应不能伪装成已就绪资产。

素材迭代复用同一 `asset.ready` 契约。CodeArts 先读取 `get_project_assets`，再以明确 assetId、`mode: "replace"` 和当前 `expectedRevision` 调用原媒体工具；Asset Store 在同一写锁内再次 CAS，旧文件哈希必须与 Manifest 一致。成功时完整 entry 替换、revision 增加；Workbench reducer 按 assetId 归并新 entry，用户刷新 preview iframe 后模板重新获取 Manifest。revision 冲突不会自动重放 Provider。

每个 Run 开始或恢复后，CodeArts 调用一次无参数 `get_gameforge_capabilities`；若回放中尚无 capability 事件，则原样发布 snapshot。快照不包含密钥或配置值。Qwen 以草拟 Provider 存在为 ready；Seedream 和 TTS 还要求 Asset Store；Freesound 要求搜索、preview 下载和 Asset Store 三者同时存在。工程能力分别反映 Asset Store、generator、verifier、preview、Run Relay 和 Task Inbox 的实际注入状态。

`submit_voice_job` 和每次单次 `query_voice_job` 返回后，CodeArts 原样发布 `voice.job.updated`。恢复时按 projectId + assetId 选择 sequence 最新的事件，从中取得签名 handle：processing 可继续单次 query，succeeded 可 materialize，failed 保留证据并决定回退。Workbench 只保留并显示 project/asset/status，不把 handle 放入归约状态或界面；但 handle 仍存在于本地 Relay 事件流和状态文件，应把它视为受限 capability data，保护 Relay 文件与访问边界。

启动本地事件服务：

```bash
bun run dev:relay
```

默认仅监听`127.0.0.1:8787`。API如下：

| 方法 | 路径 | 作用 |
|---|---|---|
| `POST` | `/tasks` | 校验 Prompt，创建 queued Task 并原子创建对应 Run |
| `GET` | `/tasks?status=queued&limit=20` | 有界列出任务快照，默认最多20项 |
| `GET` | `/tasks/:id` | 读取一项不可变 Prompt 和任务状态 |
| `POST` | `/tasks/:id/claim` | 由一个 agent ID 原子认领；同一 agent 重复调用幂等 |
| `POST` | `/runs` | 创建运行并由服务生成序号1的`run.started` |
| `POST` | `/runs/:id/events` | 追加同一运行、严格连续的事件批次 |
| `GET` | `/runs/:id/events?after=N` | 从游标后回放，单页最多1000项 |
| `GET` | `/runs/:id/stream?after=N` | SSE回放后转为实时推送 |
| `POST` | `/runs/:id/stop` | 幂等停止运行 |
| `POST` | `/runs/:id/complete` | 幂等完成运行 |

Task Prompt 长度为10至12000字符，语言只允许 `zh-CN`/`en-US`；未知字段（包括密钥）被拒绝。任务状态为 `queued`、`claimed`、`completed`、`failed`、`stopped`：未认领任务不能完成，停止可以发生在认领前，不可修复的阶段失败会同步为 `failed`；同一任务不能被不同 agent 重复认领。服务限制请求体为1 MiB、默认最多100个任务和100个运行、每个运行保留10000条事件、最多50个SSE客户端。浏览器来源默认只允许工作台的`localhost:4173`和`127.0.0.1:4173`，CLI请求可以不带Origin。

Task 创建的权威 `run.started` 可携带可选 language。由 `/tasks` 创建时必定写入规范化后的任务语言；直接 `/runs` 创建的通用 Run 为兼容旧客户端可以不带 language。Workbench 从零回放后以该字段恢复语言选择，不依赖页面内存或猜测 Prompt。旧快照和旧事件仍可解析。

`POST /tasks` 使用 Run ID 作为幂等键。相同 Run ID、规范化后完全相同的 Prompt 与语言会返回原 Task 和权威 `run.started`，包括跨快照恢复后的重试；该路径在容量已满时仍可读取原结果。相同 Run ID 但 Prompt 或语言不同则返回 HTTP 409 和 `task_run_conflict`。RunStore 为此在事件保留窗口之外单独保存权威 start event，并将其纳入快照；客户端不得通过复用 Run ID 创建新任务。

默认状态仍仅在内存中。生产入口可设置 `GAMEFORGE_RUN_RELAY_STATE_FILE`（绝对路径）启用本地快照：每次 Task/Run 变更等待串行保存队列，快照经过严格 Schema、事件连续性和 Task/Run 终态一致性校验，并以临时文件同步后 rename。启动时恢复 Task、RunEvent、终态和游标，但不恢复 SSE 连接；Workbench 和 CodeArts 应按现有回放协议重连。文件包含 Prompt、事件和日志，应使用受限目录，不放入仓库或云同步目录。若磁盘写入失败，请求返回 500，但本进程内存可能已应用该次变更；此时应停止 Relay、处理磁盘问题并从最后成功快照恢复，再由 CodeArts 使用 `replay_game_run` 对账。本机制面向单机研究，不替代数据库事务、多实例一致性或高可用存储。

Workbench 不依赖原生 `EventSource` 用旧 URL 盲目重连。SSE `error` 或真实 sequence 缺口发生后，客户端关闭旧连接，从最后成功消费的 sequence 调用 `/events?after=N` 回放连续批次，再以新游标建立 stream。网络故障采用 500/1000/2000/4000/8000 ms 的有限退避；HTTP 409 `cursor_ahead`、410 `cursor_expired` 或五次耗尽会进入显式错误，用户可点击“恢复连接”从同一游标重试。重复 sequence 被忽略，只有成功交给 reducer 后才推进游标；终态事件会关闭 stream。该恢复控制器只消费确定性 HTTP/SSE，不调用模型、MCP 或 Agent 循环。

配置 `GAMEFORGE_RUN_RELAY_URL` 后，MCP 除 Run 生命周期工具外还注册：

- `replay_game_run`：从显式 `after` 游标读取一次经过 Schema 验证的事件页，单页由 Relay 限制为最多 1000 项；不轮询、不自动翻页；
- `list_game_tasks`：读取一次有界任务快照，不轮询；
- `get_game_task`：按 Task ID 读取权威 Prompt 与 Run ID；
- `claim_game_task`：以 CodeArts agent ID 原子认领，冲突时返回稳定错误码。

这些工具只做状态协调。CodeArts 认领 Workbench Task 后先从 `after: 0` 回放，以恢复已存在的结构化产物和权威 sequence；若恰好返回 1000 项，由 CodeArts 决定是否用最后 sequence 读取下一页。游标冲突时同样只读取一次当前页，再决定如何继续。工具不等待新事件、不自动重试。何时读取、选择哪个任务、如何生成与修复仍由 CodeArts 决定。

CodeArts 新会话调用一次不带 status 的 `list_game_tasks`，优先恢复 `status: claimed` 且 `claimedBy: codearts` 的相关 Task，再选择 queued Task；同一 agent 的 `claim_game_task` 是幂等操作。恢复后根据回放中的结构化阶段与产物事件跳过已完成步骤，不重复生成项目、媒体或预览。真实集成测试使用两个独立 MCP Client 会话证明 claimed Task、已完成阶段、游标和最终 completed 状态可续接；Relay 进程重启恢复由持久化实验独立证明。

工作台连接方式：

```text
VITE_AGENT_BASE_URL=http://127.0.0.1:8787/
```

配置后工作台显示 Run ID 和 Prompt，“提交给 CodeArts”调用 `/tasks`，展示返回的 Task ID，并从 `run.started` 游标立即连接对应 SSE。连接已有 Run 仍可独立使用。GameSpec 与资产面板分别只消费 `spec.ready` 和 `asset.ready`，新 Run 会清空旧产物；未收到时明确显示等待。收到序列缺口时不会跳过事件，而是从最后连续游标自动回放并重建 stream；有限重试耗尽后显示手动恢复入口。收到 `preview.ready` 后，预览 iframe 自动切换到事件中的项目 URL；iframe 仅开放脚本与 pointer lock，不发送 referrer。未收到事件时才使用 `VITE_GAME_PREVIEW_URL`（默认 `http://localhost:5173/`）作为回退。

## 语言链路与生成运行时

1. Workbench 在提交前选择 `zh-CN` 或 `en-US`，并把 language 与 Prompt 一起写入 Task；
2. CodeArts 认领 Task 后必须调用 `draft_game_spec({ prompt: task.prompt, language: task.language })`；
3. 百炼严格 JSON Schema 要求输出 `GameSpec.locale`，Provider 会拒绝与请求 language 不一致的结果；
4. `generate_game_project` 将 locale 写入 `game-spec.json`，同时生成匹配的静态 `<html lang>` 与无障碍标签；
5. Phaser 运行时使用同一 locale 选择 HUD、胜负、重启和控制提示文案，并再次设置 `document.documentElement.lang`。

该链路只保证模板 chrome 的双语一致性，不会翻译用户 Prompt 中的标题、目标、胜负条件等内容。模型不可用时，CodeArts 手工构造 GameSpec 也必须显式写入与 Task 相同的 locale。历史 GameSpec 没有 locale 时按 `zh-CN` 处理。

“场景结构”同样只消费已验证的 GameSpec 与资产状态，显示固定 Phaser Scene、玩法系统、控制/胜负条件，以及八种运行时角色当前是资产绑定还是程序化/静音回退。“地图视图”按五种 genre 显示固定模板布局，只用于解释生成器基线，并明确标注“模板示意 · 非关卡文件”。两者都是只读投影，不向 Relay 写事件，也不让模型直接操作画布。

Workbench 页面加载时使用时间与浏览器 UUID 熵生成符合 `runIdSchema` 的新 Run ID，不再复用固定 `run-local`。提交或连接期间 Run ID 输入被锁定，避免停止/重连请求误发给另一个 Run。网络失败时不会自动轮换 ID，用户可用原 ID 重试幂等创建；只有显式点击“新任务”才在当前 Run 已终止后生成新 ID、清空 Task 回执、规格、资产、预览、日志和阶段状态。真实 Chrome 已验证“提交 → 输入锁定 → 停止 → 新任务 → ID 变化 → NO RUN → 旧回执清除”。

## 已验证结果

- 生成器单元测试覆盖确定性、dry-run零写入、原子新建、拒绝覆盖、文本/源码隔离和五种genre。
- 实际生成独立样例后，已对生成目录运行严格TypeScript检查和Vite生产构建。
- Relay测试覆盖创建、追加、客户端 Schema 回放、连续回放、SSE、CORS拒绝、游标冲突、终态原子性和订阅通知。
- Task 测试覆盖 Prompt/状态契约、原子创建 Task+Run、列表、读取、单 agent 幂等认领、认领冲突、未认领完成拒绝和终态同步。
- 工作台客户端与状态测试覆盖提交 Prompt 创建 Task、创建/回放 Run、SSE重复事件忽略、缺口自动回放、有限退避、过期游标快速失败、不安全远程URL拒绝，以及按运行切换/清空 GameSpec、资产和预览。
- 预览管理器测试覆盖托管项目校验、会话复用、并发启动合并、幂等停止和不安全 URL 清理；MCP 测试覆盖条件注册与启停调用。
- 本地工作流集成测试使用真实 HTTP Relay、MCP Client、磁盘生成器、生产 Asset Store 和受控 Vite，覆盖 Task 创建/认领、Run 回放、`spec.ready`、dry-run/apply、图片/音效/配音的魔数、哈希、角色、许可与 Manifest 落盘、三个连续 `asset.ready`、预览 HTTP 200、`preview.ready`、Run 完成与 Task 终态同步。媒体 Provider 使用明确标注的确定性测试替身；TTS 仍分为 submit/query/materialize 且不轮询。该测试不替代真实 CodeArts 或 Seedream、Freesound、火山语音账号验收。

## 运行时资产闭环

`@gameforge/asset-store` 只接受已由生成器创建的项目，核验 `.gameforge/manifest.json`、项目 ID、真实目录、媒体魔数、大小、SHA-256、角色与 MIME 的对应关系。文件固定写入 `public/assets/`，清单使用互斥锁和临时文件更新；重复 asset ID、重复运行时角色、符号链接与路径越界都会被拒绝。

`.gameforge/assets.lock` 使用 `open("wx")` 原子创建并写入 version、随机 token、PID、hostname 与毫秒时间戳，文件 mode 为 0600（Windows 按平台语义处理）。正常释放前同时核对已打开句柄的 device/inode 和路径 metadata token，路径被替换时不会无条件 unlink。发生 `EEXIST` 时先取得独立 recovery guard；只有主锁 metadata 完整、同一 hostname、年龄至少 10 分钟且 `process.kill(pid, 0)` 明确报告 PID 不存在时才回收。PID 存活/权限未知、时钟异常、近期锁、异地主机、符号链接、空文件和旧格式都保持锁定。recovery guard 自身使用同一 metadata 和保守 stale 规则，避免恢复进程崩溃后永久阻塞。

该协议面向仓库声明的单机本地文件系统；Node 官方明确 `O_EXCL` 在某些网络文件系统上可能不可靠，hostname 也不是全局身份。项目不把它宣称为分布式锁，不提供 MCP 强制解锁工具。人工排障应先停止所有相关 MCP/CodeArts 进程并备份项目，再检查 metadata，而不是自动清理。

CodeArts 重启后的 Manifest 恢复读取同样逐文件流式重算 SHA-256，并同时比对 Manifest entry 与 provenance 中的哈希；因此即使文件被替换为相同字节数，`get_project_assets` 也会拒绝恢复，而不会补发错误的 `asset.ready`。

当前生成模板会在启动时读取 `public/assets/manifest.json`：存在 `player`、`collectible`、`hazard`、`background` 时加载图片；存在 `collect-sound` 和 `hit-sound` 时播放音频。浏览器运行时只接受契约内角色、同类型 MIME、`assets/` 内规范相对路径和唯一角色；损坏、重复或类型不匹配的条目被忽略。角色图片无论源分辨率如何，都会归一化显示尺寸和 Arcade Physics 碰撞体；背景仍按 960×540 场景缩放。清单缺失、为空或单项加载失败时继续使用程序化纹理与静音回退，因此媒体 Provider 不会成为玩法可运行性的硬依赖。

存在 `voice` 角色时，模板会在玩家第一次点击或按键后播放配音，以遵守浏览器自动播放限制；存在 `bgm` 时，同一次用户手势会以 0.35 音量开始循环播放。Freesound 导入工具会把明确选择为 `bgm` 的预览记录为 `kind: "music"`，其他音效仍记录为 `kind: "sound"`，从而满足 Asset Store 的角色—来源一致性校验。解码失败时保持静音并继续游戏。

生成模板还暴露只读验证状态 `window.__GAMEFORGE_TEST__`，包含 `status`、`score`、`lives`、`remainingSeconds`、结束详情和可选 telemetry。生成器 0.2.0 的 telemetry 提供玩家、仍存活收集物与危险物的世界坐标，数值保留两位小数；胜负发生时仍保留最终 telemetry，并派发 `gameforge:outcome`。它只提供可观测状态，不接受命令、不改变玩法逻辑，供 CodeArts 设计有限动作，避免依赖缩放截图或 OCR 猜测 Canvas 状态。

受控 Vite 固定 Phaser 4.2.1 的官方 ESM 入口 `dist/phaser.esm.js`，不再使用 CommonJS/UMD `require` 入口。真实系统 Chrome 实验已取得 running 与 won 状态及 PNG；详见 [`2026-07-16-browser-telemetry`](../experiments/2026-07-16-browser-telemetry/result.md)。

MCP 侧提供两个条件注册工具：

- `request_image_asset`：执行一次 Seedream 官方请求，再将校验后的图片写入项目；MCP 输入只接受四个图片角色，无效的语音或音频角色在 Provider 调用前拒绝；
- `import_sound_asset`：执行一个官方 Freesound preview 导入操作，再记录来源、许可、署名和哈希；只读 GET 可按 Provider 传输策略有限退避。

两者均不重试、不修改玩法代码，也不实现 Agent 循环。

项目输出根配置后还注册只读 `get_project_assets`。它重新验证生成项目边界、严格 Manifest、项目 ID，以及每个引用文件存在、非符号链接、仍位于 `public/` 内；字节数、已打开句柄与路径身份、entry/provenance SHA-256 也必须一致。CodeArts 恢复 Run 时将它与已回放的 `asset.ready` 按 asset ID 对账，只为 Manifest 中缺少事件的 entry 补发当前 revision；这关闭了“媒体已落盘但事件发布前会话中断”的窗口，不会重复调用 Seedream、Freesound 或 TTS。

替换提交先将新媒体与新 Manifest 写入同目录临时文件，再把旧媒体移到随机备份路径，以硬链接的 no-replace 语义发布新文件，最后原子替换 Manifest；普通异常会逆序恢复旧文件，清理失败会与原错误一起以 `AggregateError` 报告。成功后才清理备份。Node 没有跨文件事务：进程在文件切换与 Manifest 切换之间被强制终止时，仍可能遗留 `.bak`/`.tmp` 并需要后续事务日志恢复能力；当前不把这类 kill -9/断电场景写成已验收的崩溃原子性。

## 官方依据

- [Phaser Scene生命周期](https://docs.phaser.io/phaser/concepts/scenes)
- [Phaser Loader与JSON缓存](https://docs.phaser.io/phaser/concepts/loader)
- [Phaser Graphics API](https://docs.phaser.io/api-documentation/4.0.0/class/gameobjects-graphics)
- [Phaser Arcade Physics](https://docs.phaser.io/phaser/concepts/physics/arcade)
- [Phaser Keyboard Input](https://docs.phaser.io/phaser/concepts/input)
- [Phaser 4迁移指南](https://github.com/phaserjs/phaser/blob/master/changelog/v4/4.0/MIGRATION-GUIDE.md)
