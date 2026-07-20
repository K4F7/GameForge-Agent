# 双语生成运行时结果

## 实现

- GameSpec 新增可选 `locale: "zh-CN" | "en-US"`，旧规格缺省时仍按中文处理；
- 百炼严格 JSON Schema 要求输出 locale，Provider 拒绝与请求 language 不一致的结果；
- Task 创建的权威 `run.started` 携带 language，旧事件和直接创建的通用 Run 仍可不带该字段；
- Workbench 提交语言选择，并在从零回放后恢复任务语言；
- 生成器 0.6.0 输出匹配 locale 的静态 HTML `lang`、aria-label、Phaser HUD、胜负、重启和控制提示；
- 模板增加内联空 favicon，避免系统 Chrome 首屏请求 `/favicon.ico` 产生 404 console error。

## 可复现命令

```powershell
bun experiments/2026-07-18-runtime-localization/generate.ts
Set-Location .gameforge-validation/runtime-localization-20260718-v2/english-runtime
bun install
bun run build
Set-Location ../../..
node experiments/2026-07-18-runtime-localization/verify.mjs
```

最终样例使用 generator 0.6.0，`specSha256` 为 `53afe0e988bc19e1afbb76798663d274315ed1b4c2628ffbdc355b5fdb4cacc8`。独立项目由 Bun 安装 Phaser 4.2.1、Vite 8.1.4 和 TypeScript 7.0.2，严格检查与生产构建通过；Phaser 主 chunk 仍有大于 500 kB 的已知警告。

## 真实 Chrome 证据

系统 Chrome、1280×720 视口返回：

- `document.documentElement.lang: en-US`；
- telemetry `status: running`、`score: 0`、`lives: 3`；
- 2 个 collectibles、1 个 hazard；
- Canvas 1280×720；
- console errors、page errors、failed requests 均为 0；
- 截图：生成项目内 `.gameforge/verification/locale-running.png`。

人工视觉检查确认首屏显示 `Safety Sprint`、英文目标、`Progress 0/2`、`Lives 3` 和英文控制提示；HUD 未遮挡主要玩法区域，实体基线正常，没有固定中文 chrome。

## 失败与修复

1. 首次独立构建未先在生成目录执行 `bun install`，TypeScript 不存在，构建失败；安装项目声明依赖后通过。
2. 首次浏览器脚本从仓库根裸导入 `playwright-core`，受 Bun 隔离安装影响解析失败；脚本改为显式复用 `@gameforge/game-verifier` 的 Playwright runtime。
3. 首个生成样例产生 `/favicon.ico` 404 console error；生成器增加内联 favicon 后使用全新 v2 目录重新生成，没有覆盖或手工修补旧样例。

## 整仓门禁

- `bun run check`：通过；
- `bun run test`：175 个测试通过，`apps/game` 无测试文件并按配置返回 0；
- `bun run build`：通过；Phaser 示例和生成样例保留已知大 chunk 警告；
- `bun install --frozen-lockfile`：检查 171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `bun run doctor`：`ok: true`，无密钥环境下四个基础工具可握手，云 Provider 与条件工程能力为 false；
- `git diff --check`：通过；
- 端口 4173、5173、8787：验证结束后无残留监听。

## 边界

- 本实验使用固定 GameSpec，隔离验证语言链路与模板运行时，没有调用百炼或其他云 Provider；
- 本机已安装 CodeArts 客户端，但该实验并非由真实 CodeArts 会话执行，不能作为 CodeArts Task/MCP 闭环证据；
- 用户内容不会由模板自动翻译；CodeArts/Qwen 必须生成与 Task language 一致的标题、目标和胜负文本；
- Workbench 自身管理界面仍以中文为主，语言选择控制生成任务和游戏，不等同于工作台 UI 国际化。
