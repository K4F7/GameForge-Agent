# TypeScript开源框架选型

更新日期：2026-07-17

## 决策

第一阶段采用以下底座：

- 游戏引擎：Phaser 4.2.1（MIT）
- 智能体工具协议：MCP TypeScript SDK 1.29.0（MIT）
- 规格校验：Zod 4.4.3（MIT）
- 构建和测试：Vite 8、Vitest 4
- 主编排器：CodeArts Agent / Agent Team

## 游戏框架比较

| 框架 | 特点 | 结论 |
|---|---|---|
| Phaser | 成熟的浏览器2D游戏引擎，支持TypeScript、Canvas/WebGL和官方Vite模板 | 采用 |
| KAPLAY | API简洁，适合快速小型游戏和教学 | 保留为轻量模板候选 |
| Excalibur.js | TypeScript优先，结构清晰，适合2D游戏 | 保留为类型安全对照组 |
| PixiJS | 高性能2D渲染器，但碰撞、场景和玩法系统需自行搭建 | 不作为首个完整游戏底座 |

Phaser具有成熟度、文档、示例数量和模板生态优势，更适合作为代码智能体反复生成、运行和修复项目的稳定目标。

## 智能体框架比较

| 框架 | 适用场景 | 当前决定 |
|---|---|---|
| CodeArts Agent Team | 需求规划、多角色协作、代码修改与验证 | 主编排器 |
| MCP TypeScript SDK | 向CodeArts暴露确定性工具、资源和提示 | 采用 |
| LangGraph.js | 自建有状态、长时间运行的Agent图 | 暂缓 |
| Mastra | 构建独立TypeScript Agent应用与工作流 | 暂缓 |
| Vercel AI SDK | 多模型应用UI、流式生成和工具调用 | 需要独立Web控制台时再评估 |

暂缓额外Agent框架的原因：CodeArts已经承担Agent循环和多智能体编排。第一阶段再引入LangGraph或Mastra会形成双重编排，使比赛中难以说明究竟是哪一层完成了任务。

## 架构边界

```text
CodeArts Agent / Agent Team
  ├─ AGENTS.md：持续工程约束
  ├─ Skills：需求分析与开发流程
  └─ GameForge MCP Server（TypeScript）
       ├─ 规格校验
       ├─ Provider配置校验
       ├─ 资产来源Manifest校验
       ├─ 固定版本 Phaser 项目生成
       ├─ 国产模型与媒体适配器、Asset Store
       ├─ Task/Run Relay 确定性协调
       ├─ 受控预览与浏览器验收
       └─ 结构化运行产物与验收事件

Generated Game
  └─ Phaser + TypeScript + Vite
```

构建、测试命令和失败后的代码修复仍由 CodeArts 执行与判断；MCP 只提供一次性生成、落盘、预览、验收和状态协调操作，不在工具内复制 Agent 循环。

模型与媒体资产不在MCP工具内部形成第二套Agent循环。默认国产模型路由、字节图片生成、TTS、音效检索和资产来源记录方案见[国产模型与游戏媒体资产策略](./model-media-strategy.md)。

## 官方项目

- [Phaser](https://github.com/phaserjs/phaser)
- [Phaser TypeScript与Vite模板](https://phaser.io/news/2024/01/phaser-vite-typescript-template)
- [KAPLAY](https://github.com/kaplayjs/kaplay)
- [Excalibur.js](https://github.com/excaliburjs/Excalibur)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [LangGraph.js](https://github.com/langchain-ai/langgraphjs)
- [Mastra](https://github.com/mastra-ai/mastra)
- [Vercel AI SDK](https://github.com/vercel/ai)
