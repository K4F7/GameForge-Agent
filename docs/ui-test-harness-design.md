# CodeArts / OpenChamber 外置测试框架设计草案

更新日期：2026-07-22

## 当前理解

测试框架是独立控制器；CodeArts 原版 TUI 和 OpenChamber 原版 GUI 是两个被测对象。框架可以向二者注入输入、观察变化并收集证据，但不改造二者来容纳测试界面。

```text
                    ┌──────────────────────────┐
                    │  UI Test Controller      │
                    │  scenario / watchdog     │
                    │  evidence / authority    │
                    └────────────┬─────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
        ┌────────▼────────┐             ┌────────▼────────┐
        │ CodeArts TUI    │             │ OpenChamber GUI │
        │ 原版交互会话     │             │ 原版页面         │
        │ PTY 输入与屏幕    │             │ 浏览器输入与画面  │
        └─────────────────┘             └─────────────────┘
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                      Task / Run / RunEvent
                         权威状态与证据
```

## 与此前实现的差别

此前 headed 原型把 CodeArts PTY 的 xterm 投影嵌入仓库自建 Workbench，形成一个合并观察页面。这会改变 OpenChamber GUI 的信息架构，也容易让人误认为该终端属于上游 OpenChamber 产品能力。该拓扑已放弃，自建 Workbench 及其桌面壳已经删除。

新的框架采用适配器边界：

- TUI 驱动负责真实会话、文本/按键注入、resize 和屏幕读取；
- GUI 驱动负责真实浏览器中的导航、点击、输入、截图、视频和诊断；
- Authority 驱动只读 Relay 的 Task、Run、RunEvent；
- Controller 只按权威状态推进场景，并综合 TUI、RunEvent 和项目变化判断“慢”或“卡死”；
- Evidence Sink 把两个被测面的时间线关联到同一验收记录。

## 本轮交付边界

本轮只新增 `packages/ui-test-harness/` 中的驱动接口、场景步骤、控制器、权威门禁和活动看门狗。没有运行入口、没有具体 PTY/Playwright 适配器、没有启动测试会话，也没有修改 Workbench。

## 已确认的 TUI 可见方案

控制器持有唯一 ConPTY，另开独立 xterm 窗口实时渲染同一 VT 流。输入注入、headless 屏幕解析、xterm 可见输出和原始证据必须共享同一个 sessionId 与单调 output sequence；禁止为观察窗另启 CodeArts 会话。

OpenChamber 始终是另一个独立的原版 GUI 窗口，不嵌入 TUI。控制器按依赖顺序启动 ConPTY、xterm 观察窗和 OpenChamber，并按相反顺序幂等关闭；任一阶段失败都要保留已有证据。

## 上游边界

GUI 被测对象是 OpenChamber 上游原版，而不是仓库中已经删除的派生 Workbench。历史评估曾固定提交 `31b43fbde90d368c5d131ec52e761d888466d597`；实现浏览器适配器前必须重新确认实际被测 commit，并只在测试框架中记录版本和启动信息，不复制或改造其产品页面。
