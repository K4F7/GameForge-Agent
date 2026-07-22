# CodeArts 原版 TUI 与 OpenChamber 原版 GUI 自动验收交接

更新日期：2026-07-22

## 当前目标

建立一个外置、无人值守、可观察、可留证的 UI 测试框架。两个被测对象相互独立：

- CodeArts 原版交互式 TUI；
- OpenChamber 上游原版 GUI。

外层控制器通过真实 PTY 向 CodeArts 注入文本和枚举按键，通过真实浏览器操作 OpenChamber，并把两边证据与 GameForge Task、Run、RunEvent、MCP Audit 和游戏验证结果关联起来。测试框架不是产品 UI，不得把 TUI 嵌入 OpenChamber，也不得复制 Agent 循环。

## 已锁定边界

- 非交互 `codearts run` 只用于诊断，不能冒充原版 TUI 验收。
- CodeArts 输入必须经过 Windows ConPTY/PTY；禁止直接修改数据库、伪造 Session 或退化成普通 pipe。
- OpenChamber 保持上游原版页面；仓库自建的 `apps/workbench`、`apps/desktop` 与旧 `apps/tui` 已删除。
- 控制器可以同时显示、注入和观察两个被测窗口，但不能要求用户手动点击、输入“继续”或处理普通权限提示。
- 阶段推进只接受 Task、Run、RunEvent、MCP 返回和浏览器验证等权威状态，不从模型自然语言推断完成。
- 长运行允许配置到一小时；卡死判断综合 TUI 输出、工具调用、项目变更和 RunEvent 活动，不能用无语义“继续”掩盖停顿。
- full access 只适用于隔离验收会话，不修改用户全局配置，也不扩大项目授权范围。
- 禁止部署、远程发布、抖音 preview/上传/提审/发布和未授权外部 Provider。

## 目标拓扑

```text
                       UI Test Controller
                scenario / watchdog / evidence
                    /                       \
                   /                         \
        CodeArts TUI Driver          OpenChamber GUI Driver
        real ConPTY session          real headed browser
        text/key injection           click/fill/press/navigation
        screen snapshots             screenshot/video/diagnostics
                   \                         /
                    \                       /
               GameForge Authority Driver
                 Task / Run / RunEvent
```

OpenChamber 不承载 CodeArts 终端、测试状态或证据面板。最终通过/失败与证据位置写入外置报告。

## 当前代码状态

`packages/ui-test-harness/` 已建立可审查的第一层框架：

- `CodeArtsTuiDriver`：start/read/send text/send key/resize/stop；
- `OpenChamberGuiDriver`：launch/navigate/click/fill/press/snapshot/close；
- `GameForgeAuthorityDriver`：只读权威状态；
- `EvidenceSink`：记录生命周期、输入、TUI/GUI 快照、活动和权威状态；
- `UiTestController`：执行声明式步骤、权威门禁、观察保留与综合活动看门狗。

当前刻意没有 `run` CLI，也没有具体 PTY、Playwright、Relay 或 Evidence 适配器，因此导入该包不会启动进程、浏览器或测试会话。先由用户检查拓扑，再实现可运行适配器。

此前未跟踪的 `packages/codearts-session-host/` 原型源码已经删除，仅可能残留被 `.gitignore` 排除的本机构建产物；它不是当前 Git 实现，也不能作为验收依据。

## 已确认的可见方案

控制器持有唯一 ConPTY，并在独立 xterm 窗口渲染同一 VT 流。xterm 观察窗、TUI 输入、headless screen 和原始 VT 证据使用相同 sessionId；禁止启动第二个 CodeArts 会话充当观察面。OpenChamber 是另一个独立窗口，不承载终端。

## 后续适配器要求

### CodeArts TUI

- 只能启动仓库固定的 `bun run codearts` 链路，不接受任意 executable、command 或 args；
- 使用新的 session ID、隔离 data/config 和受管证据目录；
- 文本输入有界，支持中文和 bracketed paste；按键只接受枚举；
- 输出、输入和 resize 使用单调 sequence；
- ConPTY 不可用时明确失败，禁止 pipe fallback；
- 终止只清理当前会话进程树。

### OpenChamber GUI

- 运行前固定并记录实际上游仓库与 commit；
- Playwright headed/watch 操作的必须就是用户看到的浏览器上下文；
- 不向页面注入产品功能、终端投影、测试状态或权限 UI；
- 只访问 loopback OpenChamber、Relay 和受管预览地址；
- 收集视频、阶段截图、console error、page error 和 failed request。

### 权威状态与卡死判断

- Authority Driver 只读 Relay Task、Run、RunEvent；
- 阶段 gate 必须有总超时和活动超时；
- 活动样本至少包含 TUI output sequence、RunEvent sequence、最后事件类型和项目指纹；
- 超时时记录是总超时还是活动超时，以及最后一次有效活动依据。

## 证据目录

完整原件只写入仓库忽略目录：

```text
.gameforge-validation/<experiment>/sessions/<session-id>/
  metadata.json
  lifecycle.ndjson
  input.ndjson
  output.vtlog
  screen-frames.ndjson
  final-screen.txt
  activity.ndjson
  mcp-audit.json
  run-events.json
  gui/
    browser-report.json
    openchamber.webm
    *.png
```

日志和帧必须有数量或字节上限；达到上限记录截断事件，但最终屏幕、生命周期、RunEvent 和浏览器报告仍须落盘。提交到 `experiments/` 的摘要必须脱敏。

## 历史结果

2026-07-22 的旧原型曾把 CodeArts TUI 投影进仓库自建 Workbench，并完成后台 evidence smoke；该拓扑已被用户明确否决，相关产品界面和未跟踪 Session Host 源码均已删除。旧会话与实验结果只能证明当时的技术探索，不能证明当前外置框架已经完成。

此前真实主链仍在基线阶段暴露 CodeArts 26.6.2 / GLM-5.1 长响应与 malformed tool JSON 问题，固定 Bug 和技能阶段没有形成完整通过证据。脱敏记录保留在 `experiments/2026-07-22-codearts-live-acceptance/`。

## 完成条件

- 两个独立被测窗口的拓扑与独立 xterm 可见方案已经确认；
- 具体适配器经过代码审查后再提供显式运行命令；
- 后续真实运行必须证明自动注入、同一会话证据、两个窗口可见、权威阶段连续和三类浏览器诊断；
- 未运行前不得声称测试、smoke 或端到端验收通过。
