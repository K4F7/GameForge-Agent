# ADR-0001：游戏渲染与桌面界面边界

状态：接受  
日期：2026-07-18

## 决策

GameForge 默认生成运行时继续使用 Phaser 4.2.1、TypeScript 和 Vite。当前不把核心迁移到 React Three Fiber，也不直接改成原生 Three.js。

未来出现明确的 3D 游戏模板需求时：

- React 宿主、编辑器面板和游戏状态需要共享组件生命周期时，优先评估 React Three Fiber；
- 需要低层渲染控制、非 React 运行时、定制加载/物理/性能调试时，优先评估原生 Three.js；
- 两者都只能作为独立的 3D 模板或编辑器表面，不能进入 MCP、Relay、Asset Store 或 Agent 循环。

桌面状态界面优先评估 Tauri 2 封装现有 React Workbench，Electron 仅作为兼容性备选。本 ADR 不授权立即增加 Rust、Tauri 或 Electron 依赖。

## 原因

Phaser 已有固定版本生成器、浏览器验证器和真实 CodeArts 闭环。此时迁移渲染栈会同时扩大生成、修复、资产、性能和验收变量。R3F 与 Three.js 的开源项目价值主要是 3D 场景组织和编辑器交互，不构成替换稳定 2D 默认模板的证据。

Tauri 能复用 Workbench 且安装体积较小，但系统 WebView 差异、Rust 工具链、签名和自动更新仍需三平台验证；因此先保持 Web Workbench 与 Bun TUI 可独立运行。

## 不变量

- CodeArts 是主智能体；渲染层和桌面壳不认领、规划或完成 Run。
- MCP 保持确定性，且不依赖 React、Phaser、Three.js、R3F、Tauri 或 Electron 生命周期。
- Generated Game、Workbench/TUI、客户端集成可以分别替换，不改变 RunEvent 和资产 Manifest 协议。
- 默认 2D 模板的构建与浏览器验收不能因新增 3D 模板而退化。

## 重新评估触发条件

只有同时满足以下条件才创建 3D 模板实现 ADR：

1. 有可复现的 3D 游戏或编辑器需求，而非仅展示场景；
2. R3F 与 Three.js 原型使用相同 GLB、输入和验收脚本完成对照；
3. 记录首屏时间、帧时间、包体、资产加载失败、CodeArts 首次生成成功率和修复次数；
4. 选择方案能在 Chrome 自动验收中稳定复现，并有独立模板版本与回滚路径。

只有 TUI 共享 controller 稳定且以下检查通过，才开始 Tauri spike：Windows/macOS/Linux CI、WebView 中预览 iframe 的 CSP/sandbox、最小文件权限、安装包签名与更新策略。任何平台无法满足时，保持 Web Workbench，并用 Electron 做同范围对照而非直接迁移。

Web Workbench 的 CSP、预览 origin allowlist、iframe 权限和桌面最小权限基线见 [Workbench 与桌面壳安全边界](../workbench-security.md)。该基线完成不等于 Tauri 三平台 WebView、签名或更新机制已经验收。

## 验证

- `apps/game/package.json` 只保留 Phaser 默认依赖；核心 packages 不新增渲染或桌面依赖。
- `bun run check && bun run test && bun run build` 在三平台 CI 执行。
- 新 3D 或桌面实现必须新建 ADR 和实验记录，不能修改本 ADR 来掩盖对照结果。
