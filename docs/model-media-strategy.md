# 国产模型与游戏媒体资产策略

更新日期：2026-07-18
官方资料访问日期：2026-07-18

国产厂商 SOTA、独立权威榜单、编码/视觉/媒体专项评测及 oh-my-openagent 当前状态的详细交叉分析见 [2026-07 模型评估](./model-evaluation-2026-07.md)。本文件保留生产 Provider 与资产边界；榜单不能替代账号实际可用性和 GameForge 同 Task 验收。

## 待验证主张

1. GameForge可以默认使用中国厂商提供的模型完成需求理解、游戏设计、代码生成和修复。
2. 游戏图片默认由字节跳动体系的模型生成，并保留后续替换模型版本的能力。
3. NPC对白、旁白和短提示音可以通过国产TTS生成。
4. 常见游戏音效应优先从许可证明确的素材库检索；独特音效和背景音乐再调用生成模型。
5. 模型调用不能破坏现有架构边界：CodeArts是主智能体，MCP工具内部不实现第二套Agent循环。

## 决策摘要

| 游戏制作环节 | 默认Provider | 默认模型或能力 | 备选 | 决策状态 |
|---|---|---|---|---|
| 需求理解、玩法设计、任务规划 | CodeArts 当前账号 | `huaweicloud-maas/deepseek-v3.2` | GLM-5.1；跨宿主评估 Kimi K3 | 采用实际可选模型；不得把未列出的 K3 写成 CodeArts 已可用 |
| GameSpec结构化生成、分类和摘要 | 阿里云百炼 | `qwen3.6-flash` | Qwen本地小模型 | 采用，必须通过Schema二次校验 |
| TypeScript、Phaser和Three.js代码生成与修复 | CodeArts 当前账号 | `huaweicloud-maas/deepseek-v3.2` | GLM-4.7 ArkTS；跨宿主 Qwen Coder/Kimi K3 | 采用实际账号模型，外部编码模型需独立基准 |
| 剧情、世界观、对白与本地化 | CodeArts 当前账号 | `huaweicloud-maas/GLM-5` | GLM-5.1；跨宿主 MiniMax M2.7/Kimi K3 | 采用独立 story 路由；输出仍需剧情 Schema 与内容审核 |
| 长上下文仓库审查、截图复核 | Moonshot/Kimi | `kimi-k3` | GLM-4.6V、Seed1.5-VL | 跨宿主评估；当前 CodeArts 模型列表没有 K3 |
| 角色立绘、场景、概念图和图像编辑 | 火山方舟 | Seedream系列 | 即梦图片生成4.0 | 采用Seedream；实际模型ID从配置读取 |
| NPC对白、旁白和语音提示 | 火山引擎豆包语音 | 大模型语音合成 | CosyVoice本地部署、腾讯云对话式TTS | 采用 |
| 常见短音效 | Freesound API | CC0优先检索 | CC BY并自动生成署名清单 | 采用检索优先；它不是默认基础模型 |
| 独特短音效 | 可插拔Audio Provider | 暂无满足要求且公开稳定的国产独立文生音效API | Seedance音画联合生成实验 | 暂不设伪默认 |
| 背景音乐 | MiniMax 开放平台 | `music-2.6` | 腾讯云 MPS 聚合；火山 MemeSong 仅短主题曲 | planned；官方 API 已确认，适配器、纯音乐效果与商用授权尚待验收 |

### 已实现的 GameSpec 适配器

仓库已实现 `BailianGameSpecProvider` 与条件注册的 MCP 工具 `draft_game_spec`。服务端设置 `DASHSCOPE_API_KEY` 后，适配器调用百炼官方 OpenAI 兼容端点 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`；`GAMEFORGE_SPEC_MODEL` 可覆盖默认的 `qwen3.6-flash`。请求使用 `response_format.type = json_schema` 与严格 Schema，并对模型返回再次执行 `gameSpecSchema.parse`。百炼官方建议对 429、5xx 和连接错误执行有界指数退避，因此确定性传输层最多尝试三次；它不改变 Prompt、模型或请求体，也不承担 Agent 规划、反思或代码修改。

当前证据只覆盖模拟官方 HTTP 契约、错误脱敏和本地 Schema 验证；尚未使用真实百炼账号验证模型可用性、结构化输出兼容性、延迟和费用。

GameSpec 草拟的严格 JSON Schema 现在还要求 `gameplay`：目标数、危险数、初始生命和移动速度。四项均在契约层设有小型游戏安全上限，并由生成器真实消费；这减少 Qwen 只改文案、不改变玩法难度的风险。旧的手工 GameSpec 仍向后兼容，可由生成器按 genre 使用默认值。

这里的“默认使用国产模型”约束的是模型Provider。Freesound属于有许可证元数据的素材检索服务，不参与推理，也不能替代国产模型完成设计或生成任务。

## 文本与代码模型路由

### 默认路由

- `planner`：当前 CodeArts 使用账号实际提供的 `huaweicloud-maas/deepseek-v3.2`，用于玩法拆解、架构设计、关卡规划和工具编排。
- `spec`：`qwen3.6-flash`，用于从自然语言提取GameSpec、资产清单和任务分类；输出必须再次经过Zod校验。
- `coder`：当前 CodeArts 使用 `huaweicloud-maas/deepseek-v3.2`；宿主支持外部 Coding Plan 时再比较 `qwen3-coder-plus` 与 K3。
- `story`：当前 CodeArts 使用账号实际提供的 `huaweicloud-maas/GLM-5`，专门生成剧情结构、角色卡、对白和本地化草案；GLM-5.1 复核。跨宿主再比较 MiniMax M2.7 与 Kimi K3，但不得静默替换实际生效模型。
- `reviewer`：当前 CodeArts 优先 GLM-5.1，并与生成步骤使用不同提示词；构建、测试和静态检查仍是最终证据。
- `vision`：跨宿主优先评估 Kimi K3，备选 GLM-4.6V/Seed1.5-VL；当前 CodeArts 列表没有已确认的视觉模型时，不把截图审查记为已完成。

Qwen官方资料确认Qwen3系列具备代码、工具调用、思考/非思考模式以及长上下文能力；Qwen3-Coder面向Agent式编码和工具调用。阿里云函数调用文档列出了Qwen3-Coder、Qwen-Plus和Qwen-Flash系列。具体快照版本会变化，因此仓库只提供经过验证的默认值，不将模型ID散落在业务代码中。

Kimi K3 作为跨宿主长上下文与视觉评估方案。它不会替换 MCP 中已实现的 Qwen GameSpec、Seedream、豆包 TTS 或 Freesound 适配器；宿主未提供 K3 时不把它放入可执行 fallback，也不能静默把其他模型记成 K3。

CodeArts 普通 CLI 通过 `codearts models [provider]` 列出当前账号可用模型，并用 `provider/model` 选择；截至访问日，公开 CLI 帮助没有个人用户任意配置 Base URL 或 BYOK Provider 的入口。CodeArts 企业版官方“配置模型”支持管理员接入第三方大语言模型，但只接受 OpenAI 规范的 `/chat/completions` 接口。管理员完成接入且模型真实出现在宿主列表后，GameForge 才能把它加入 Agent fallback。MCP 可以封装外部模型的一次确定性调用，但这不会改变 CodeArts 主 Agent 使用的模型。

### Kimi K3 与宿主实际可用性

Kimi 官方于 2026-07-16 发布 `kimi-k3`。官方资料给出的事实包括：2.8T 参数 MoE、原生视觉、最长 1M context，以及在 Kimi Code/API 中进行长时编码、仓库导航和终端工具编排；API 模型 ID 是 `kimi-k3`，Kimi Code 中也提供 `k3`。官方同时明确 API 当前不直接支持视频输入、PPT 和 Deep Research，完整权重计划在 2026-07-27 开放，且官方建议自部署至少使用 64 个加速器，因此普通开发机不把本地 K3 作为默认。

GameForge 对这些事实的推断是：K3 最适合跨宿主的长上下文编排、代码审查和浏览器截图复核；不用于 Seedream 生图、TTS 或短音效。2026-07-18 使用已配置的 CodeArts CLI 凭据只读调用 `models`，当前账号实际列出 DeepSeek V3.2、GLM-4.7 ArkTS、GLM-5 和 GLM-5.1，没有 K3。故当前 CodeArts 生产默认使用实际可选的 `huaweicloud-maas/deepseek-v3.2` 做编排/编码、GLM-5.1 做高层复核；K3 只进入 OpenCode/其他宿主评估 fallback，直到宿主真实列出该模型并完成同 Task 基准。模型列表证据不含凭据或账号信息。

### 从 oh-my-opencode 借鉴的路由原则

oh-my-opencode/后续更名项目 oh-my-openagent 的官方配置把 agent role 与 task category 分开，并按“显式用户覆盖 → 类别默认 → 用户 fallback → Provider fallback → 宿主默认”解析；utility/explore 使用快速低成本模型，deep/oracle 使用高推理模型，视觉类别独立选择视觉模型，doctor 可显示最终解析链。GameForge 只借鉴以下配置思想：

1. `orchestration`、`coding`、`story`、`review`、`quick`、`vision` 是 CodeArts 拥有的 Agent 路由；
2. `spec`、`image`、`tts`、`sound`、`music` 是 MCP 单次确定性操作，不复制 oh-my-opencode 的 Agent 循环；
3. 每条路由显式记录 primary、fallback、能力和 reasoning 档位；仅事件实际失败或宿主缺少模型时才走下一项；
4. 运行记录必须写实际生效模型，而不是配置中希望使用但宿主未提供的模型；
5. 快速任务不滥用最昂贵的长上下文模型，视觉任务不交给无视觉能力的模型。

可提交示例位于 `config/model-routing.example.json`，由 `modelRoutingPolicySchema` 和集成测试验证。当前可执行 Agent 路由只包含本次 `codearts models` 已确认的模型；未确认的视觉路由保持缺省。Schema 以受支持国产 Provider 与模型家族 ID 的匹配规则约束推理与生成模型，并保持 Freesound 的所有 fallback 都是许可证检索；家族规则不是当前账号模型 allowlist。`officialApiRequired` 表示只允许仓库已登记的官方适配器，但不能证明账号授权或实时可用性；示例不替代宿主当前 `models` 输出。

### 配置原则

```text
# CodeArts Agent 模型通过宿主 models 列表与 --model provider/model 选择
GAMEFORGE_SPEC_MODEL=qwen3.6-flash
GAMEFORGE_IMAGE_PROVIDER=volcengine-ark
GAMEFORGE_IMAGE_MODEL=<控制台可用的Seedream模型ID或Endpoint ID>
GAMEFORGE_TTS_PROVIDER=volcengine-speech
```

代码中的默认图片模型ID为已有公开API文档的`doubao-seedream-4-0-250828`；运行时可替换为账号控制台当前可用的Seedream版本或Endpoint ID。Provider配置同时声明每个Provider的能力；路由契约会拒绝不匹配的国产 Provider/模型 ID、工具 Provider/能力组合及非 Freesound 的音效 fallback。

只提交变量名和示例，不提交API Key、Access Key、Secret Key、音色授权材料或账号信息。

## 字节跳动图片生成

默认图片Provider采用火山方舟Seedream。官方图片生成API使用`/api/v3/images/generations`，`model`接收模型ID或推理Endpoint ID，支持文本提示、参考图片、尺寸、组图和Base64或临时URL响应。Seedream 4.0官方资料确认其统一支持文生图、单图/多图编辑和图像组合。

### 官方SDK评估

2026-07-16评估了官方`@volcengine/ark-runtime@1.0.10`。该版本已经导出`ArkRuntimeClient.withApiKey()`和`generateImages()`，比README中遗留的`createImage()`示例更接近当前图片API。但安装后执行`npm audit --registry=https://registry.npmjs.org`发现其传递依赖带来1个critical、5个high和1个moderate漏洞，且当时没有自动修复版本；问题链路包含旧版`protobufjs`和`axios`。仓库因此撤回该依赖，审计恢复为0个已知漏洞。

当前Seedream适配器继续直接调用官方REST端点，并保留请求Schema、官方主机锁定、参考图主机白名单、Base64上限、图片魔数检查和来源哈希。生产请求使用 120 秒确定性超时；成功响应按“配置的图片上限对应 Base64 长度 + 1 MiB envelope”流式读取，声明长度或 chunked 实际长度越界都会在 JSON 解析前拒绝并取消。直接 Model ID 必须与官方响应 `model` 一致；使用 `ep-` 推理接入点时允许响应解析为实际模型并将实际模型写入 provenance。方舟官方没有给图片生成提供可核验的幂等键，因此默认不自动重试生图 POST；调用方只有在接受重复计费风险时才能显式配置有界重试。这里的“优先官方实践”是优先官方协议和官方SDK评估，不意味着在官方SDK存在未修复高危依赖时仍强制采用。后续官方SDK修复依赖链后再重新评估迁移。

建议任务映射：

| 资产 | 生成方式 | 后处理与验收 |
|---|---|---|
| 角色立绘 | 角色设定图作为参考图，生成单张或系列图 | 检查脸部、手部、服饰一致性和内容安全 |
| 场景背景 | 文生图或参考图风格迁移 | 裁切到游戏宽高比，检查主体与可交互区域冲突 |
| UI图标 | 统一风格提示词生成图标集 | 去背景、缩放到目标尺寸并人工检查可读性 |
| 纹理 | 生成纹理概念图 | 检查接缝；需要平铺时必须额外处理 |
| 精灵动画 | 先生成角色关键姿势参考 | 不直接承诺规则Sprite Sheet；由切图、对齐和逐帧检查工具完成 |

官方API资料没有确认Alpha透明通道。URL响应示例为JPEG，因此透明背景必须作为显式后处理步骤，不能在Provider能力表中标记为已支持。

即梦图片生成4.0是备选Provider，统一覆盖文生图、图像编辑和多图组合，但使用火山公共OpenAPI签名方式，与方舟的兼容接口不同，应放在独立适配器中。

## TTS与游戏配音

默认使用豆包大模型语音合成：

- 短对白和提示：使用流式或非流式TTS，生成后缓存为游戏资产。
- 长旁白：使用异步长文本接口，避免在游戏构建过程中等待长连接。
- 固定NPC：使用平台音色；需要声音复刻时必须记录说话人授权、用途和有效期。
- 动态对话：只在确有实时剧情需求时启用流式合成，默认游戏构建仍使用预生成音频，以保证可复现和离线运行。

豆包官方资料确认大模型TTS支持流式/非流式、在线SDK和SSML；产品资料确认支持情感表达及短样本声音复刻。声音复刻属于高风险能力，默认关闭。

截至2026-07-16，官方V3文档已确认单向流式WebSocket地址为`wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream`，并建议新音色使用V3接口；但公开页面未能稳定提取完整JSON请求体、二进制事件号和HTTP分块结束语义，也未找到可核验的官方Node V3 SDK。仓库因此不根据第三方实现猜测实时协议。当前先采用官方字段完整的异步长文本接口，并暴露提交、单次查询和素材化三个工具；实时短句接口仍等待控制台官方示例后单独实现。

备选方案：

- CosyVoice：适合私有化和离线生成。官方仓库说明其覆盖9种语言、18种以上中文方言、跨语言零样本声音克隆、情感/语速/音量指令，并支持双向流式。
- 腾讯云对话式TTS：适合实时NPC对话和SSE/WebSocket链路。
- 百度情感TTS：适合中文短对白的显式情绪控制。

## 音效与音乐

### 常见音效：检索优先

跳跃、按钮、碰撞、脚步、开门等常见音效优先从Freesound API检索。该API支持搜索和获取声音元数据。下载策略必须同时执行：

1. 默认筛选CC0。
2. 找不到合适结果时允许CC BY，并在`THIRD_PARTY_ASSETS.md`生成名称、作者、原始URL和许可证。
3. 排除CC BY-NC和Sampling+，避免商业使用和遗留许可风险。
4. 保存声音ID、下载日期、许可证、来源URL和文件哈希；许可证缺失则拒绝导入。
5. 对下载内容进行格式、时长、峰值、静音段和恶意文件检查。

Freesound API本身的使用条款与单条声音许可证是两个独立层次：免费API仅允许非商业用途，商业使用需要联系Freesound取得协议。因此适配器强制声明`non-commercial`或`commercial-agreement`，不会因为搜索结果是CC0就自动推断API可用于商业项目。

当前已实现`FreesoundProvider`和条件注册的`search_sound_asset` MCP工具。它调用官方`GET /apiv2/search/`，通过`Authorization: Token`传递服务端密钥，明确请求所需字段，默认筛选`Creative Commons 0`，可显式允许`Attribution`，并拒绝`Attribution NonCommercial`。GET 搜索与 preview 下载可在 429、5xx、超时或网络失败时最多尝试三次；响应 JSON 限制为 4 MiB，preview 限制为 16 MiB，声明或流式实际长度超限都会取消 body。结果返回官方页面URL、预览URL、作者、原始许可证文本和归因字符串；原始文件下载需要OAuth2，不属于当前只读Token适配器。

### 独特音效：保留Provider边界

截至访问日，没有找到同时满足“国产、公开稳定API、独立文本生成短音效、商业条款清晰”的默认服务。Seedance 1.5 Pro/2.0官方资料确认可以联合生成环境音效、背景音乐和人物语音，但其主要输出是音视频，不应伪装成独立短音效API。

因此先定义`AudioGenerationProvider`接口但不绑定默认实现。后续可以通过实验验证：

- Seedance生成音画后抽取音轨，再检查能否稳定得到可循环短音效；
- 新增国产独立文生音效API后直接接入；
- 对合成器类UI音效使用Web Audio程序化生成，不调用模型。

### 背景音乐

生产候选改为 MiniMax `music-2.6`：[官方音乐生成指南](https://platform.minimaxi.com/docs/guides/music-generation)与[官方 API](https://platform.minimax.io/docs/api-reference/music-generation)（访问日期：2026-07-18）提供同步音乐生成接口，并将使用场景列为视频、游戏和应用的背景音乐/主题曲。当前路由标记为 `planned`，因为仓库尚未实现适配器，也尚未核验纯器乐稳定性、生成耗时、套餐对应的商用授权和内容权利；公共 `resolveExecutableModelTargets` 对 planned 路由返回空数组。腾讯云 MPS 聚合可作为统一云入口备选，但底层模型和合同仍需逐项记录。火山 MemeSong 只支持中文、15 秒内模板化歌唱，更适合短主题曲，不冒充通用 BGM 或 SFX。

玩法代码、剧情、美术和配乐不得共用一个“万能默认模型”：玩法走 CodeArts `coding`，剧情走 CodeArts `story`，美术走 Seedream `image`，配乐走 MiniMax `music`。CodeArts `orchestration` 只负责拆分任务、选择已启用路由并汇总证据；MCP 媒体工具仍然只执行一次确定性 Provider 调用。

## Provider架构边界

```text
CodeArts Agent / Agent Team
  ├─ 需求理解、规划、代码修改和工具编排
  └─ GameForge MCP Server
       ├─ validate_game_spec        已实现：确定性Schema校验
       ├─ validate_provider_config  已实现：Provider路由与秘钥边界校验
       ├─ validate_asset_manifest   已实现：资产来源清单校验
       ├─ generate_game_project     已实现：dry-run + 原子新建固定模板
       ├─ request_image_asset       已实现：单次Seedream调用 + 安全资产落盘
       ├─ submit/query/materialize_voice_job 已实现：异步TTS作业三步工具
       └─ search_sound_asset        已实现：有界只读检索 + 许可证与API用途过滤

Provider adapters
  ├─ LlmProvider
  ├─ ImageGenerationProvider     Seedream适配器已实现，真实账号待验证
  ├─ TextToSpeechProvider
  ├─ SoundSearchProvider          Freesound适配器已实现，真实账号待验证
  └─ AudioGenerationProvider
```

MCP工具只执行一次明确业务操作、返回结构化结果并记录元数据，不在内部进行自主规划、反思或循环调用。共享传输层只对 408、429、5xx、超时和网络错误做最多三次的有界退避，并把认证、授权、配额、限流、调用方取消、超时、网络、服务端和请求错误分类为 `ProviderRequestError`；调用方取消立即停止，错误消息不读取或回显上游 body。Seedream 生图和 TTS submit 默认单次发送，因为官方没有幂等保证；TTS query/materialize 与 Freesound GET 可以安全重试。任务拆解与业务级重试仍由CodeArts负责。

所有外部资产都进入统一Manifest，至少记录：

```ts
type AssetProvenance = {
  assetId: string;
  kind: "image" | "voice" | "sound" | "music";
  origin: "generated" | "retrieved" | "procedural";
  provider: string;
  model?: string;
  prompt?: string;
  sourceUrl?: string;
  license: string;
  attribution?: string;
  sha256: string;
};
```

## 实验步骤

接入每个Provider前分别执行，不用一次启用全部服务：

1. 用同一份中文游戏需求分别生成GameSpec，记录模型、耗时、Token、Schema通过率和人工修正次数。
2. 用固定TypeScript任务比较`qwen3-coder-plus`与备选模型，实际运行`bun run check`和`bun run test`。
3. 使用同一角色设定让Seedream生成立绘、背景、图标和关键姿势，检查一致性、尺寸、透明背景后处理和人工淘汰率。
4. 用同一段NPC对白生成中性、快乐、紧张三种情绪，检查发音、情感、时长、响度和复刻授权记录。
5. 使用十个常见音效查询测试CC0命中率；每个导入文件都验证许可证元数据和哈希。
6. 对背景音乐Provider检查循环点、长度、格式、生成耗时和输出使用条款。

## 实际结果

已完成官方资料调研、架构决策、Provider配置、运行事件和资产Manifest契约，并实现Seedream文生图与Freesound搜索适配器。Seedream适配器已通过模拟HTTP响应验证Bearer请求、超时/网络错误脱敏、受限 JSON、Base64解码、模型一致性、图片格式识别、SHA-256和资产来源记录；同时限制官方API主机、参考图主机白名单和最大响应字节数。Freesound适配器已通过模拟响应验证Token Header、许可证查询、预览选择、非商业许可证拒绝、官方端点限制和错误脱敏。MCP仅在服务端同时配置API密钥与用途声明时注册`search_sound_asset`。
此外已经实现 Freesound preview 素材化、安全资产存储，以及火山异步长文本 TTS 的提交、查询和素材化闭环。Freesound preview 下载按 16 MiB 上限流式读取，缺少或伪造 `Content-Length` 的 chunked 响应也会在越界时取消，不会先执行无界 `arrayBuffer()`。TTS 适配器测试覆盖官方 Header/URL/字段、签名句柄、跨项目拒绝、下载主机白名单、格式识别、哈希与凭据脱敏；当前仍未使用真实付费账号验证音色效果和实际 CDN 主机。

工作台侧已经增加严格的Wire RunEvent契约、连续序列批次校验、轮询回放函数和SSE客户端边界；它会忽略重复事件，并在序列缺口时要求回补。仓库现在包含只负责保存和发布事件的本地Run Relay，配置`VITE_AGENT_BASE_URL`后工作台可以创建或连接真实运行。Relay不执行游戏生成任务，也不实现Agent循环；任务执行和工具编排仍由CodeArts负责。未配置Relay时界面继续明确显示“事件演示 · 未连接Agent”。

本轮没有配置云端密钥，也没有真实调用模型生成图片或音频，因此不能声称模型效果、价格、延迟或商业授权已经通过实验确认。

## 结论与置信度

- 高置信度：采用配置化国产模型路由；Qwen负责默认文本/代码任务；Seedream负责默认图片；豆包语音负责默认TTS；常见音效执行许可证过滤检索。
- 中置信度：具体Qwen和Seedream模型快照。云端模型更新较快，接入时需要在控制台再次确认可用ID。
- 低置信度：独立国产短音效生成和生成内容商业授权。在获得明确API及条款前不设置默认实现。

## 未解决问题

1. CodeArts运行环境能够选择哪些国产底层模型，需要在实际账号中确认；仓库无法强制修改托管产品的底层模型。
2. Seedream当前账号可用模型ID、单价、并发限制和Alpha输出能力需要控制台实验。
3. 豆包可用音色、资源包价格和声音复刻授权流程需要账号侧确认。
4. Freesound在目标网络环境中的可访问性、CC0命中率及项目API使用协议需要实测或确认。
5. 音乐和生成资产的商业使用权必须以实际购买的服务条款和项目用途为准。

## 2026-07-16 适配器结论补充

- `request_image_asset` 已实现为“单次 Seedream 请求 + 安全资产落盘”，只有服务端同时具备方舟密钥、模型 ID、输出许可声明与项目根目录时才注册。
- `import_sound_asset` 已实现为“有界 Freesound preview GET + 安全资产落盘”。只读下载遇到瞬时故障时可有限退避；preview 不需要 OAuth2，原始文件 `/download/` 需要 OAuth2，当前工具不会调用它。允许 CC0 与 Attribution，后者把作者、声音名称、原始页面和许可写入 provenance。
- 豆包旧版单向流式 TTS 使用二进制 WebSocket `wss://openspeech.bytedance.com/api/v1/tts/ws_binary`，客户端必须拼接音频帧并识别结束序列；它不能按普通 JSON HTTP 适配器实现。
- 长文本 TTS 是 `/api/v1/tts_async/submit` 与 `/query` 的异步作业，结果通常需等待数十分钟、最长可到 3 小时，且回调不保证到达。当前已经实现 `submit_voice_job`、`query_voice_job`、`materialize_voice_job` 三个确定性工具：作业句柄经 HMAC 签名并绑定 project ID、asset ID、voice type、格式和文本哈希；CodeArts 决定查询时机，MCP 内部不循环等待。submit/query 后以结构化 `voice.job.updated` 保存 signed handle 和状态，新 CodeArts 会话可从 Relay 回放后继续 query 或 materialize；Workbench 不保存或显示完整 handle，普通日志也不得包含它。素材化只接受配置白名单中的 HTTPS 音频主机，并检查 Content-Type、64 MiB 上限、媒体魔数、格式和 SHA-256。

## 官方证据

### 文本与代码

- [阿里云百炼 OpenAI Chat 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)（访问日期：2026-07-16）
- [阿里云百炼限流应对最佳实践](https://help.aliyun.com/zh/model-studio/rate-limiting-best-practices)（访问日期：2026-07-18）
- [Qwen3官方仓库](https://github.com/QwenLM/Qwen3)
- [Qwen3-Coder官方发布](https://qwenlm.github.io/blog/qwen3-coder/)
- [阿里云百炼Function Calling](https://help.aliyun.com/zh/model-studio/qwen-function-calling)
- [Qwen Code模型Provider](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/)
- [Kimi对话补全、结构化输出与工具调用](https://platform.kimi.com/docs/api/chat)
- [Kimi K3 官方发布](https://www.kimi.com/blog/kimi-k3)（访问日期：2026-07-18）
- [Kimi Agent 与 K3 概览](https://www.kimi.com/help/agent/agent-overview)（访问日期：2026-07-18）
- [Kimi Code 模型与上下文限制](https://www.kimi.com/code/docs/en/kimi-code/models.html)（访问日期：2026-07-18）
- [Kimi API 模型能力边界](https://www.kimi.com/help/kimi-api/api-model-selection)（访问日期：2026-07-18）
- [DeepSeek Tool Calls 官方文档](https://api-docs.deepseek.com/guides/tool_calls)（访问日期：2026-07-18）
- [智谱 Function Calling](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling)（访问日期：2026-07-18）
- [智谱 GLM-4.6V](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v)（访问日期：2026-07-18）
- [oh-my-opencode 配置与模型解析](https://github.com/opensoft/oh-my-opencode/blob/dev/docs/configurations.md)（访问日期：2026-07-18；dev 文档会变化）
- [oh-my-openagent Agent/Model Matching](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/agent-model-matching.md)（访问日期：2026-07-18；更名过渡项目）
- [CodeArts CLI 模型命令](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0034.html)（访问日期：2026-07-18）
- [CodeArts 企业自定义模型](https://support.huaweicloud.com/usermanual-enterprise/codeartsagent_enterprise_0009.html)（访问日期：2026-07-18）

### 图片与视频音效

- [火山方舟图片生成API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)
- [火山方舟官方Node/TypeScript Runtime SDK](https://www.npmjs.com/package/@volcengine/ark-runtime/v/1.0.10)
- [Seedream 4.0官方发布](https://seed.bytedance.com/en/blog/seedream-4-0-officially-released-beyond-drawing-into-imagination)
- [即梦图片生成4.0 API](https://api.volcengine.com/api-docs/view?action=JimengT2IV40GetResult&serviceCode=cv&version=2024-06-06)
- [Seedance 1.5 Pro音画联合生成](https://seed.bytedance.com/en/blog/sound-and-vision-all-in-one-take-the-official-release-of-seedance-1-5-pro)
- [Seedance 2.0官方发布](https://seed.bytedance.com/blog/seedance-2-0-official-launch)

### TTS

- [豆包大模型语音合成API](https://www.volcengine.com/docs/6561/1257543)
- [豆包大模型语音合成V3单向流式接口](https://www.volcengine.com/docs/6561/2228192?lang=zh)
- [豆包精品长文本语音合成异步接口](https://www.volcengine.com/docs/6561/1096680?lang=en)
- [豆包语音鉴权说明](https://www.volcengine.com/docs/6561/1105162?lang=zh)
- [豆包语音产品能力](https://www.volcengine.com/products/Audio-editing-and-sound-processing)
- [CosyVoice官方仓库](https://github.com/FunAudioLLM/CosyVoice)
- [腾讯云对话式TTS](https://cloud.tencent.com/document/product/647/131300)
- [百度情感TTS公告](https://ai.baidu.com/support/news?action=detail&id=3267)

### 音效与音乐

- [Freesound API](https://freesound.org/docs/api/)
- [Freesound API Overview 与错误码](https://freesound.org/docs/api/overview.html)（访问日期：2026-07-18）
- [Freesound API v2搜索资源](https://freesound.org/docs/api/resources_apiv2.html)
- [Freesound Token鉴权](https://freesound.org/docs/api/authentication.html)
- [Freesound API使用条款](https://freesound.org/docs/api/terms_of_use.html)
- [Freesound许可证说明](https://freesound.org/help/faq/)
- [阿里云Fun-music API](https://www.alibabacloud.com/help/en/model-studio/fun-music-api)
- [FunMusic官方仓库](https://github.com/FunAudioLLM/FunMusic)
- [字节Seed-Music官方发布](https://seed.bytedance.com/en/blog/seed-music-music-large-model-officially-released-exceling-in-both-music-generation-and-editing-covering-ten-types-of-creative-tasks-to-meet-diverse-needs)
