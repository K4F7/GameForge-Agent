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
├── packages/contracts/               # 需求与游戏规格Schema
├── packages/mcp-server/              # CodeArts可调用的MCP工具
├── docs/
│   ├── codearts-quickstart.md         # 安装与首次验证
│   └── comparison.md                 # 三种代码智能体对比
└── experiments/                      # 后续基准任务与实验记录
```

## 第一阶段里程碑

- [ ] 安装并登录 CodeArts Agent IDE 或 CLI
- [ ] 用 CodeArts 打开或克隆本仓库
- [ ] 验证 `AGENTS.md` 是否被自动识别
- [ ] 调用项目级 `research-verify` Skill
- [ ] 完成一个“理解—修改—测试—报告”的基准任务
- [ ] 保存日志、耗时、人工干预次数和测试结果

## 技术底座

- CodeArts Agent：主智能体、规则、Skills和Agent Team。
- TypeScript：全部业务代码与工具代码。
- Phaser 4：浏览器2D游戏引擎。
- MCP TypeScript SDK：向CodeArts暴露确定性工程工具。
- Zod：需求和游戏规格校验。
- Vite + Vitest：构建和自动化测试。

## 快速开始

```bash
npm install
npm run build
npm test
npm run dev:game
```

先阅读 [CodeArts 快速开始](docs/codearts-quickstart.md)，然后在 CodeArts 智能体模式中输入：

```text
阅读 AGENTS.md 和 docs 目录，总结当前项目目标；不要修改文件。然后列出完成第一个可复现实验所需的步骤和验收条件。
```

## 资料来源

- [CodeArts Agent 产品文档](https://support.huaweicloud.com/productdesc-codeartssnap/codeartsdoer_pd_0001.html)
- [CodeArts Agent CLI](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0001.html)
- [CodeArts Skills](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0024.html)
- [CodeArts MCP](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)
