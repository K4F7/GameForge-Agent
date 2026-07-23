# CodeArts 原版 TUI 实时验收结果

> 历史说明：下述 Workbench/xterm 结果属于已删除原型，只证明当时的技术探索，不代表当前外置测试框架或原版 OpenChamber GUI 已通过。

## 工具调用与耗时

- Session Host 暴露 7 个受限 MCP 工具：start、read、send text、send key、resize、status、stop。
- 主链每次使用一个真实 PTY 会话、一个 CodeArts MCP 进程与一个隔离 Relay 状态文件；具体 MCP 顺序和耗时保存在本机脱敏 Audit，不在仓库复制私有会话。
- 最新只读 GUI smoke 用时约 38 秒，成功完成并保存 WebM 与四个阶段截图。
- 最终主链基线用时约 20 分钟后由权威 Relay 里程碑超时终止。

## 已通过

- 真实 CodeArts TUI、ConPTY 双向输入、中文粘贴、枚举键、resize 与有界进程树清理。
- xterm headless 与 Workbench xterm 同源 VT 流；viewer Origin/token/首帧认证/重连 snapshot。
- CodeArts 26.6.2 隔离 full-access 双层权限配置，未修改用户全局配置。
- 最新只读 GUI smoke 的 console error、page error、failed request 均为 0。
- 默认 Workbench bundle 门禁通过；终端仅在显式配置 Session Host 时构建。
- 外部媒体 Provider、部署和平台发布调用均为 0。
- `bun audit --prod` 在固定 `@hono/node-server` 2.0.11 后报告 0 个漏洞。

## 失败与修复

1. Bun 自动加载 `.env.local` 导致未授权媒体配置进入 MCP：Session Host 改用 `bun --no-env-file` 并清除 Provider 环境变量。
2. CodeArts 写入位置曾被猜成仓库应用目录：Skill 与验收 Prompt 固定受管输出相对路径并禁止修改 `apps/game`。
3. `permission: "allow"` 未覆盖 CodeArts 自有权限存储：按当前二进制实际格式增加隔离 `global.json` 与 `bash_mode: "always_allow"`。
4. 浏览器工具的 120 秒内部界限被 10 秒 MCP 客户端 timeout 截断：客户端 timeout 调整为 180 秒并增加测试。
5. 清除上述本地阻塞后，最终新批次仍在第一个 edit 前持续生成；20 分钟后 Task 仍为 claimed、Run 仍为 running、最后事件为 code 阶段开始。

## 结论

旧原型中的真实 PTY、实时 GUI、证据链和安全控制面通过；《星火遗迹》基线、同会话 Bug 修复和技能附加需求未通过。失败 Run 未标记成功，也没有用终端文字或 GUI 零报错替代权威 browser verification。后续只应在 CodeArts/GLM-5.1 长响应稳定性发生变化后，以全新 Task/Run/输出目录重跑。
