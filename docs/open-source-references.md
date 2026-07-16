# 游戏Agent开源项目参考

更新日期：2026-07-16
官方仓库访问日期：2026-07-16

## 筛选原则

- 必须能访问源代码和许可证，不把只有论文、产品页或演示视频的项目列为可复用代码。
- 优先选择能够生成可玩游戏、验证运行结果、展示Agent过程或提供游戏编辑器的项目。
- 许可证只说明代码使用边界，不自动覆盖模型权重、生成内容、示例素材和第三方资产。
- 借鉴优先级依次是：接口与状态设计、测试方法、页面信息架构、独立组件；不整仓复制。

## 第一优先级

### OpenGame

- 仓库：[leigest519/OpenGame](https://github.com/leigest519/OpenGame)
- 许可证：Apache-2.0
- 技术栈：TypeScript，Node.js，支持Canvas、Phaser和Three.js模板。
- 定位：从单个Prompt端到端生成Web游戏。

最值得借鉴：

1. `Template Skill`根据游戏类型选择稳定模板，不让Agent每次从空目录发明架构。
2. `Debug Skill`在沙箱中启动游戏，读取构建、控制台和交互错误后继续修复。
3. `agent-test/templates`和`agent-test/docs`将模板与运行知识分开积累。
4. OpenGame-Bench把验证拆成Build Health、Visual Usability和Intent Alignment，而不是只检查编译。
5. 启动时展示各模态Provider状态，图片、视频、音频和推理Provider分别配置。

GameForge应优先复现它的“模板—运行—观察—修复—证明”闭环，但继续保留CodeArts作为主智能体，不复制OpenGame内部Agent循环。当前仓库提交历史还较短，README也注明完整评测管线尚待发布，因此不能只依赖其宣传结果。

### PromptCastGameExample

- 仓库：[noumena-labs/PromptCastGameExample](https://github.com/noumena-labs/PromptCastGameExample)
- 许可证：MIT
- 技术栈：Next.js、React、React Three Fiber、Rapier、Zustand、Zod、浏览器本地LLM。
- 定位：玩家输入自然语言，分阶段生成可在运行时执行的3D法术。

关键路径：

- `src/game/ai/grammar/`：约束模型只能生成合法JSON结构。
- `src/game/spells/spellSchema.ts`：Zod运行时Schema。
- `src/game/ai/spellLog.ts`：带阶段标签的生成日志。
- `src/game/ai/spellGenerationError.ts`：包含`stage`和`canRepair`的可修复错误。
- `src/game/ai/pipeline/`：Concept与Balance分阶段调用。

GameForge应借鉴“模型输出先进入受约束数据层，再进入游戏运行时”，以及前端中的阶段进度和Repair重试。该项目使用R3F不代表GameForge要迁移React；可以只借鉴生成管线、错误状态和UI交互。

### Agentshire

- 仓库：[Agentshire/Agentshire](https://github.com/Agentshire/Agentshire)
- 许可证：MIT
- 技术栈：TypeScript、Three.js，多页面Web前端。
- 定位：把AI Agent显示为3D城镇NPC，并提供地图与角色编辑器。

关键路径与页面：

- `town-frontend/src/scene/`：城镇和办公室场景。
- `town-frontend/src/editor/`：角色工坊与地图编辑。
- `town-frontend/src/engine/`：渲染和游戏循环。
- `town-frontend/src/data/`：前后端事件协议。
- `index.html`：Town与Chat双模式。
- `editor.html`：拖放地图编辑、对齐、撤销和JSON导出。
- `citizen-editor.html`：角色创建与配置。
- `preview.html`：独立游戏预览。

GameForge前端最适合借鉴它的多入口设计：Agent工作台、游戏预览、资产/角色工坊和地图编辑器相互独立，通过统一事件协议连接。第三方模型与可选资产包仍要分别核验来源，不能因主仓库MIT就默认素材可自由使用。

### Godogen

- 仓库：[htdt/godogen](https://github.com/htdt/godogen)
- 许可证：MIT
- 技术栈：Python/Shell调度；目标支持Godot、Bevy和Babylon.js TypeScript/Vite。
- 定位：Agent生成代码与资产、运行游戏，并用实时画面或录像证明结果。

最值得借鉴：

- `engines/`：按引擎拆分工程知识与运行约束。
- `prompts/runtime.md`：运行验证清单。
- `asset-gen/`：跨引擎资产生成工作流。
- `publish.sh`：把宿主Agent和目标游戏工程分离。
- “Proof over claims”：从运行画面发现可见缺陷，而不是把成功编译当作完成。

GameForge可以采用相同思想：生成目录是可独立运行的游戏工程，Agent仓库只保留模板、工具、评测和实验记录。

## 第二优先级

| 项目 | 许可证 | 适合借鉴 | 注意事项 |
|---|---|---|---|
| [OpenHands](https://github.com/OpenHands/OpenHands) / [Agent Canvas](https://github.com/OpenHands/agent-canvas) | 各组件分别核验 | 多Agent Server、REST事件流、后端切换、沙箱、任务时间线、终端和文件Diff | 仓库正在拆分迁移；企业目录与开源组件许可不能混看 |
| [ChatDev 2.0](https://github.com/OpenBMB/ChatDev) | Apache-2.0 | YAML工作流、Agent/任务配置、Vite+Vue控制台、工作流同步与Schema校验 | Python Agent循环不应嵌入MCP工具 |
| [AI Town](https://github.com/a16z-infra/ai-town) | MIT | 世界状态、事务化模拟循环、角色关系、暂停/恢复、地图数据 | 重点适合游戏内NPC，不是游戏代码生成器 |
| [Dreamlab Engine](https://github.com/WorldQL/dreamlab-engine) | Apache-2.0 | TypeScript多人游戏引擎、可视化编辑器、Behavior脚本和实时协作 | 与当前Phaser模板差异较大，先借鉴编辑器交互 |
| [MarioGPT](https://github.com/shyamsn97/mario-gpt) | MIT | 文本到Tile关卡、继续采样、A*自动代理验证可玩性 | 项目较旧且只覆盖Mario式关卡 |
| [MetaGPT](https://github.com/FoundationAgents/MetaGPT) | MIT | 产品经理—架构师—工程师—评审的角色化SOP和产物仓库 | 只借鉴角色职责，不再引入第二个Agent编排框架 |

## 媒体资产与音效参考

| 项目 | 许可证 | 可借鉴部分 | 复用判断 |
|---|---|---|---|
| [ComfyUI](https://github.com/comfy-org/ComfyUI) | GPL-3.0 | 节点工作流、队列、进度预览、把Prompt和Seed写入产物 | 仅架构参考；不要直接把GPL代码并入当前MIT项目 |
| [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) | Apache-2.0代码 | `runtime/python/fastapi/server.py`、流式TTS与本地部署 | 可实现本地TTS备选；模型许可证另查 |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | MIT代码 | FastAPI语音服务、零样本与跨语言音色 | 代码可参考，模型和训练数据单独核验 |
| [Stable Audio 3](https://github.com/Stability-AI/stable-audio-3) | MIT代码 | 文本到音效/音乐、音频续写和局部编辑 | 模型使用Community License，不能只看代码MIT |
| [Freesound API](https://freesound.org/docs/api/) | API与单条素材分别授权 | 文本检索、音频特征、预览、作者和许可证元数据 | CC0优先；CC BY生成归因；排除BY-NC |
| [Phaser Loader](https://docs.phaser.io/phaser/concepts/loader) | Phaser MIT | 统一key、加载队列、进度/失败事件、图片/图集/音频/JSON缓存 | 可直接用于生成游戏的Asset Manifest加载层 |

`ChatTTS`代码和模型分别采用AGPL与CC BY-NC，仅适合研究，不作为GameForge商业可用默认方案。

## 推荐的GameForge前端

综合上述项目，前端不应只是一个聊天框。建议形成以下工作台：

```text
┌─ Provider状态 / 运行 / 停止 / 导出 / 实验编号 ─┐
│ 需求与GameSpec │ 游戏预览 / 场景编辑 / 地图 │ Agent任务时间线 │
│ 资产与授权     │ 独立iframe或预览窗口      │ 工具调用/修复状态 │
├──────────┴────────────────┴──────────────┤
│ 终端 / 构建 / 测试 / 控制台 / 截图与视觉验收                 │
└────────────────────────────────────────────────┘
```

对应参考：

- 中央预览和视觉证明：OpenGame、Godogen。
- Agent时间线、终端、Diff和后端切换：OpenHands Agent Canvas。
- 生成阶段、失败位置和Repair按钮：PromptCastGameExample。
- Town/Chat切换、地图编辑、角色工坊和独立预览：Agentshire。
- 声明式多Agent任务图：ChatDev，但工作流仍由CodeArts执行。
- 图片、配音和音效任务队列：借鉴ComfyUI交互，不复制GPL源码。

## 建议阅读顺序

1. 精读OpenGame的`agent-test/templates`、Game Skill、Provider配置和集成测试。
2. 精读PromptCast的`src/game/ai`与`spellSchema.ts`，确定GameSpec到安全运行时对象的分层方式。
3. 精读Agentshire的`town-frontend/src/editor`、`engine`、`data`和四个页面入口，确定GameForge控制台信息架构。
4. 精读Godogen的`engines`、`runtime.md`与发布脚本，设计运行态视觉验收。
5. 精读OpenHands Agent Canvas事件流与沙箱边界，设计长任务状态和人工接管。

## 不采用或谨慎采用

- ParallaxPro官方仓库明确当前代码尚未开源，因此不列入可复用实现。
- GPT Pilot官方仓库已停止维护，只适合参考阶段状态，不作为依赖。
- Phaser Editor 2D只有部分前端插件为MIT，后端桥接包含商业组件，不能按全开源项目处理。
- OpenGame展示游戏中包含知名影视和游戏IP，示例Prompt与素材不能直接成为GameForge模板资产。
- 未经逐项许可证核验，不下载或提交任何候选仓库的模型权重、生成样例和资产包。

## 2026-07-16 补充候选

| 项目 | 许可 | 最适合借鉴 | 采用判断 |
|---|---|---|---|
| [Agent Game Forge](https://github.com/0x0funky/agent-game-forge) | Apache-2.0 | 本地 daemon + Web UI、场景拖放、碰撞体编辑、SQLite 任务状态、密钥隔离 | 与本项目定位最接近，优先阅读 `apps/`、`packages/contracts/` 与 `.agents/skills/`，不直接复制其尚未稳定的接口 |
| [Phaser React TypeScript Template](https://github.com/phaserjs/template-react-ts) | 以仓库 LICENSE 为准 | React UI 与 Phaser Scene 的双向通信、Vite 工程边界 | 可用于工作台与预览桥接；生成游戏仍保持独立 Phaser 项目 |
| [react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | 声明式 3D 场景、React 状态和交互 | 只用于未来 3D 编辑器/Agent Town，不替换当前 Phaser 2D 默认模板 |
| [Browser Use](https://github.com/browser-use/browser-use) | MIT | 浏览器动作、截图和控制台证据 | 借鉴验证思路；本地游戏优先使用更轻量、确定的 Playwright 脚本 |
| [AutoGen](https://github.com/microsoft/autogen) | 代码 MIT | 消息运行时和事件流 | 只参考事件与职责分层，不再引入第二套 Python Agent 运行时 |
| [CrewAI](https://github.com/crewAIInc/crewAI) | MIT | Flow/DAG 与角色职责 | 只参考工作流展示，不让 MCP 工具承担 Agent 编排 |

`murrkit` 宣称是 MIT 的 Phaser 3 + TypeScript 自主游戏制作 Agent，但本轮未能稳定复核其仓库、目录和许可证原文，因此暂不列为可复制代码来源。Phaser Editor v5 有很强的 AI/MCP 编辑体验，但属于商业产品，只作为交互参考。

## 下一步验证

本轮只完成官方仓库调研，没有复制候选代码。下一步应分别做三个小型原型：

1. 采用OpenGame式模板与Debug Skill，为现有Phaser示例建立浏览器可玩性验证。
2. 采用PromptCast式Schema管线，实现GameSpec到确定性模板参数的生成和Repair错误状态。
3. 采用Agentshire/OpenHands式布局搭建GameForge工作台骨架，再接入真实Agent事件。
