# 环境就绪检查档首次真实 headed 闭环

日期：2026-07-26

## 输入与验收目标

- 在真实依赖上完整走一遍新命令面：`testenv:status` → 启动常驻依赖 → `testenv:readiness`（headed）→ `testenv:down`。
- 验证就绪检查档的全部门禁在真实环境成立：真启动 CodeArts 至 TUI 就绪、双窗可见、GUI 挂载等待、浏览器诊断干净、Authority 写入与独立读回、档位标注落盘。
- 不提交任务、不等待权威终态、不调用外部媒体 Provider、不部署发布。

## 准确版本

- OpenChamber：`v1.16.3`，commit `8040d43b251a015eb06d96135a442abd4d2f2e27`（submodule `--reference` 本地主检出初始化，无网络克隆）。
- CodeArts Agent：26.6.2（`%USERPROFILE%\.codeartsdoer\installers\bin\codearts.exe`，本机真实安装）。
- Run Relay：本分支 `packages/run-relay` 构建产物，`node dist/index.js`。
- Playwright：`playwright-core@1.61.1`；xterm：`@xterm/xterm@6.0.0` / `@xterm/headless@6.0.0`。
- Harness：分支 `feat/testenv-readiness`（PR #45）。

## 执行事实

### 环境准备

- `bun install --frozen-lockfile`（vendor/openchamber）：退出码 0，3169 packages，15.1s。
- `bun run build:web`：退出码 0。
- OpenChamber 生产服务：`node packages/web/bin/cli.js serve --foreground --port 43163 --plain`，首页 HTTP 200。
- Run Relay：`node packages/run-relay/dist/index.js`，`GET /tasks?limit=1` 返回 `{"tasks":[]}`、HTTP 200。
- `bun run testenv:status`：四项全 OK（契约校验探针对真实服务生效），退出码 0。

### 发现并修复的缺陷

首次 readiness 运行失败：`Playwright helper received an unknown command: navigate`。根因是 helper 的 else-if 链把「同 URL 导航 no-op」的判断并进了分支条件——`command === "navigate" && page.url() !== value` 在同 URL 时整体为假，落入链尾的未知命令拒绝。该缺陷在 `origin/main` 上同样存在；就绪检查场景（launch 后立即导航同一 baseUrl）是第一条真正触发它的路径。

修复：no-op 判断移入分支体内；回归测试并入 `playwright-remote-wait.fixture.mjs`（真实 helper + Chrome 黑盒，launch 后对同 URL 显式 `navigate` 再断言零诊断）。

### 就绪检查通过（修复后）

命令：`bun dist/cli.js --headed --tier readiness --experiment live-readiness --failure-hold-ms 3000 --observation-hold-ms 3000`

- 退出码 0，`result.json.status = "completed"`，场景 `testenv-readiness:baseline`。
- 分阶段耗时：`tui.start` 10.6s（**CodeArts 从 spawn 到 TUI 就绪的首个真实测量值**）、`observer.open` 1.1s、`gui.launch` 1.9s、`steps` 1.5s、`hold` 3.0s、`teardown` 0.7s；总计 18.8s，60s 软预算内。
- 档位横幅在终端两次输出（开始与结束），明示「不构成对产品行为的验收结论」。
- `metadata.json` 含 `tier: "readiness"`；`projectId` 为 `testenv-readiness-` 前缀；`taskId`/`runId` 真实关联（Task 经真实创建并独立读回）。
- 截图五张按序落盘：`loaded`、`before-interaction`、`after-interaction`、`after-gui-wait`（`#root > *` 可见等待真实执行）、`readiness`；最终诊断为零。
- 两个可见窗口（xterm 观察窗、OpenChamber Chrome）真实打开并按序关闭。

### 收尾

`bun run testenv:down`：两个服务均按 PID 定位、镜像校验为 node.exe、taskkill 后验证 PID 消失与端口释放，退出码 0。

## 人工干预

无。全程命令驱动；两次窗口弹出为 headed 模式预期行为。

## 429 / fallback

未发生。未配置、未调用任何外部模型或媒体 Provider；就绪检查档按设计不消耗模型额度。

## 结论与剩余风险

- 就绪检查档的全部验收判据首次在真实依赖上成立；「环境可用」的回答成本从一次完整真实验收降到 ~19 秒且零额度。
- 修复的同 URL 导航缺陷同时影响真实验收档的远程路径，属于上游（main）既有缺陷，本分支修复。
- 剩余：真实验收档（`testenv:acceptance`）在本轮未执行——它要求 Agent 真实完成 Task，消耗模型额度，且既有门禁未因本分支改动；其上一次完整通过记录见 `experiments/2026-07-23-openchamber-v1.16.3-observer-joint-validation/`。
- 原始 Evidence 位于忽略目录 `.gameforge-validation/live-readiness/sessions/f79ecae6-9bf9-4ac7-bd90-2b9f79f4f0c1/`。
