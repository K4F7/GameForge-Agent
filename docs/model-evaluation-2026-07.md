# 国产模型 SOTA 与排行榜评估（2026-07）

更新日期：2026-07-18  
资料访问日期：2026-07-18

## 评估方法

GameForge 不用单一榜单决定所有环节，采用四层证据：

1. 厂商官方模型/API/模型卡，确认模型真实发布、输入模态、context、tool use、API ID 和商业可用性；
2. 独立持续榜单，观察通用推理、Agent、视觉、生图或语音的相对位置；
3. 专项编码/工具榜，严格区分裸模型、Agent scaffold、尝试次数与公司自报；
4. GameForge 同 Task 基准：Bun check/test/build、MCP audit、Relay event、真实 Chrome won/lost 和人工干预才是最终选型依据。

LMArena 是匿名成对偏好投票，适合观察用户偏好，但受样本语言、风格和位置偏差影响；Artificial Analysis v4.1 是可复述的独立英语文本评测，九项任务按固定权重组成，95% 置信区间通常小于 ±1%，但不代表中文、视觉或音频；OpenCompass/SuperCLUE 更接近中文和可复现学术评测，但版本会滚动替换，旧快照不可与新榜直接横比。

## 通用与 Agent 模型

| 模型 | 可核验最新证据 | 适合 GameForge | 重要限制 |
|---|---|---|---|
| Kimi K3 | Artificial Analysis Intelligence Index 57、全球第 3；GDPval-AA v2 Elo 1668；AutomationBench-AA 53% 第 1 | 长上下文仓库规划、工具编排、跨文件审查、视觉复核 | 当前 CodeArts 账号未列出；AA Omniscience 幻觉率 51%；截至 7 月 17 日权重尚未发布 |
| GLM-5.2 | Artificial Analysis Index 51 | 高推理复核、Agent fallback | 独立榜测试名不等于当前 CodeArts 的 GLM-5.1；必须以宿主列表为准 |
| DeepSeek V4 Pro | Artificial Analysis Index 44，约 $0.04/task | 成本敏感的复杂文本/工具任务 | 当前 CodeArts 只列 DeepSeek V3.2，不能冒充 V4 Pro |
| MiniMax M3 | Artificial Analysis v4.1 同档 44；官方开放平台另列 M2.7/M2.5 等 | Agent/API 候选 | M3 正式发布日期、稳定 API 文档需进一步核验，不进入默认 |
| Kimi K2.6 | Artificial Analysis v4.1 Index 43；官方平台列 256K、视觉/文本、thinking | K3 不可用时的 Kimi fallback | 排名低于 K3；与 K3 API/权重状态不能混写 |
| Step-3.5-Flash-2603 | 阶跃官方 API，建议 256K，支持 Function Calling | 快速/成本层候选 | 未找到可与 AA 直接比较的官方独立分数、价格或开放权重证据 |
| ERNIE 5.0 | 百度千帆官方表：`ernie-5.0`、128K、最大输出 65536 | 中文需求/企业 API 候选 | 没有本轮可核验的同版本独立 Agent 排名 |
| Seed1.6 | 字节 Seed 官方称最新通用系列并已开放火山 API | 字节生态通用模型候选 | API ID、价格、独立榜需按火山控制台继续核验 |

Artificial Analysis 的 K3 结果约消耗 1.32 亿输出 token，属于大规模独立测试；但其指数仍只覆盖英语文本。K3 的官方 1M context、原生视觉和 terminal/tool 编排能力支持将它放在跨宿主 `orchestration`/`review`/`vision`，不能因此替换专用 Seedream/TTS，也不能跳过事实核验。

## 编码与工具调用

### 可引用成绩

- SWE-bench 官方榜当前可见 GLM-5 high reasoning 72.80（2026-02-17，约 $0.53）与 Kimi K2.5 high reasoning 70.80（约 $0.15）。这是完整 Agent+模型结果，不是裸模型能力。
- Kimi K2 官方博客自报：LiveCodeBench v6 53.7、SWE-bench Verified agentic single 65.8 / multiple attempts 71.6、SWE-bench Multilingual 47.3、Aider Polyglot 60.0。公司自报与官方榜必须分栏。
- NIST/CAISI 2025 评测给 DeepSeek V3.1 SWE-bench Verified 54.8±2.4，提供第三方旧版本锚点，但不能代表 V3.2/V4。

### 为什么不按 SWE-bench Verified 单榜选模型

OpenAI 2026 年抽查 138 题，报告至少 59.4% 存在测试会拒绝功能正确解等缺陷，并指出公开仓库/补丁造成污染，建议转向 SWE-bench Pro。GameForge 因此按以下顺序看编码证据：

1. GameForge 自己的 TypeScript/Phaser/Three.js 修改和 Bun 门禁；
2. SWE-bench Pro/Multilingual，观察真实仓库和跨语言修改；
3. Terminal-Bench 2.1，观察 CLI/环境工具链；
4. τ²/τ-bench，观察多步工具调用和最终状态一致性；
5. Aider Polyglot，观察编辑协议与多语言代码；
6. LiveCodeBench 只作为算法生成补充。

当前 CodeArts 实际列出的 `huaweicloud-maas/deepseek-v3.2` 因“真实可用”优先作为编排/编码默认，GLM-5.1 做复核；K3/Qwen Coder/GLM-5.2 必须在宿主真实提供后用同 Task 重新比较。

## 视觉理解、生图和语音

### 视觉理解

- Seed1.5-VL 官方技术报告：Thinking MMMU 77.9、MMMU-Pro 67.6；官方称 60 个公开 VLM 基准中 38 项 SOTA。属于厂商报告/API 自测。
- Qwen2.5-VL-72B 官方模型卡：MMMU 70.2、MMMU-Pro 51.1、DocVQA 96.4。与 Seed 报告设置可能不同，不直接做差值排名。
- Kimi K3 官方确认原生视觉和 1M context，但截至访问日没有官方公开 MMMU 数字；第三方未核验的 81.6 不进入决策。

所以 `vision` 的评估顺序是：宿主可用 K3 → Seed1.5-VL → GLM-4.6V/Qwen-VL，并用固定 Workbench/游戏截图集验证错误发现率和误报率。

### 生图

Artificial Analysis Image Arena 使用众包盲选。动态快照中 Seedream 5.0 Lite 约 Elo 1115、约第 55、约 7971 票；另一个 Arena 快照曾给 Seedream 4.5 约第 13，两个时间/模型/样本不同，不能据此称 5.0 更差或 4.5 永久领先。Seedream 5.0 Pro 已加入动态榜但稳定分数尚不足。

用户要求字节生图，因此 Seedream 继续是默认 Provider；模型 ID 以账号方舟 Endpoint 为准。选版本时使用相同角色、背景、UI 图标和关键姿势提示词，记录一致性、可用率、人工淘汰、成本和延迟，而不是引用单一 Elo。

### TTS 与音效

SpeechArena 当前只有 217 场、18 个模型，仍明确标注 early；MiniMax Speech 2.8 尚未参与，CosyVoice 和豆包 TTS 不在榜内。因此没有权威证据支持宣称某国产 TTS 是全球 SOTA。豆包 TTS 继续作为已实现的默认国产适配器，CosyVoice 作为私有化/离线备选，最终按固定中文对白的发音、情绪、稳定性、授权和成本评估。

截至访问日也没有可核验的持续榜证明国产独立文本生成短音效 API 已成熟。常见音效继续使用 Freesound 许可证检索；它是检索服务，不是默认基础模型。独特音效保持 Provider 插槽，不伪造默认。

## oh-my-opencode / oh-my-openagent 现状

- 官方仓库已更名为 `code-yeongyu/oh-my-openagent`；npm 包和 CLI 仍以 `oh-my-opencode` 为主，并在改名期双发布。不要运行无关的 `npx omo`。
- 2026-07-18 查询 npm registry，`oh-my-opencode` latest 为 4.19.0，发布时间 2026-07-17；GitHub 可见 v4.18.1 release，页面可能滞后于 npm。
- 推荐配置名/插件名为 `oh-my-openagent`，legacy `oh-my-opencode` 仍加载并给迁移警告；已有 issue 记录改名期间某些 OpenCode loader hang，必要时回退 legacy 插件名。
- 模型解析优先级是 UI/用户覆盖 → category default → `fallback_models` → Provider fallback → system default；主动 model fallback 与默认关闭的 runtime error fallback 分开。runtime fallback 默认关注 429/500/502/503/504、最多 3 次、冷却 60 秒。
- doctor 会报告模型能力、legacy package 和 compatibility fallback。模型能力来源依次包含 Provider runtime、缓存的 models.dev 和启发式 family/alias，因此 doctor 仍需用真实宿主模型列表交叉验证。
- 未找到 OpenCode 1.18.3 的明确兼容声明，不能仅因最新版插件发布就安装到生产环境。

GameForge 借鉴其 role/category、显式能力要求、可诊断 fallback 与成本层；不安装其编排核心，不复制 Sisyphus/Oracle 等 Agent 循环，也不把 GameForge 核心实现为 Plugin。当前先保持仓库自己的严格 `modelRoutingPolicySchema`，等独立沙箱验证 OpenCode 1.18.3 + oh-my-openagent 后再决定是否只启用其路由/doctor 能力。

## 当前决策

| GameForge 路由 | 当前默认 | 何时升级 |
|---|---|---|
| CodeArts orchestration/coding | 实际可用 DeepSeek V3.2 | K3/GLM-5.2/DeepSeek V4 真正在宿主可选并通过同 Task |
| CodeArts review | 实际可用 GLM-5.1 | 有独立审核基准和更低误报时 |
| 跨宿主 long-context/vision | Kimi K3 评估首选 | OpenCode Provider 修复、K3 可选并完成浏览器/代码基准 |
| MCP GameSpec | Qwen3.6 Flash | 真实百炼 Schema 通过率/成本基准支持升级 |
| MCP image | 字节 Seedream Endpoint | 固定资产集实测选择账号可用版本 |
| MCP TTS | 豆包异步 TTS | 固定对白集与授权/成本证据支持切换 |
| MCP music | MiniMax Music 2.6 纯音乐 | 真实账号固定提示集证明效果、循环点、耗时与输出权利后再调整版本 |
| MCP common sound | Freesound CC0/CC BY 检索 | 有稳定国产独立音效 API 与商业条款后 |

## 主要来源

- [Artificial Analysis Kimi K3 独立评测](https://artificialanalysis.ai/articles/kimi-k3-achieves-3-in-the-artificial-analysis-intelligence-index-comparable-to-opus-4-8-and-gpt-5-5)
- [Artificial Analysis Intelligence Index v4.1](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-1)
- [Artificial Analysis 方法](https://artificialanalysis.ai/methodology/intelligence-benchmarking)
- [LMArena 方法](https://www.lmsys.org/blog/2023-05-03-arena/)
- [LMArena Style Control](https://www.lmsys.org/blog/2024-08-28/style-control/)
- [OpenCompass Academic 榜规则](https://opencompass.readthedocs.io/en/stable/notes/academic.html)
- [SuperCLUE 官方仓库](https://github.com/CLUEbenchmark/SuperCLUE)
- [SWE-bench 官方榜](https://www.swebench.com/index.html)
- [OpenAI：不再使用 SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
- [Terminal-Bench 2.1](https://www.tbench.ai/news/terminal-bench-2-1)
- [LiveCodeBench](https://github.com/livecodebench/livecodebench)
- [Aider Polyglot](https://aider.chat/docs/leaderboards/edit.html)
- [τ-bench 论文](https://arxiv.org/abs/2406.12045)
- [Seed1.5-VL 官方仓库](https://github.com/ByteDance-Seed/Seed1.5-VL)
- [MMMU 官方榜](https://mmmu-benchmark.github.io/)
- [Qwen2.5-VL 官方模型卡](https://huggingface.co/Qwen/Qwen2.5-VL-32B-Instruct/blob/main/README.md)
- [Artificial Analysis Image Arena](https://artificialanalysis.ai/image/leaderboard/text-to-image)
- [SpeechArena](https://www.speecharena.org/leaderboard)
- [oh-my-openagent 官方仓库](https://github.com/code-yeongyu/oh-my-openagent)
- [oh-my-openagent 模型匹配](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/agent-model-matching.md)
- [oh-my-openagent 配置](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md)
