# 实验任务

日期：2026-07-18

## 输入任务

在已经完成 Bun TUI 的基础上，为 GameForge 增加一个最薄的 Tauri 2 GUI spike：复用现有 Workbench，保持 CodeArts 为主智能体、MCP 为确定性工具，不新增桌面 Agent 循环，并用真实 Windows 构建证明配置可用。

## 验收条件

1. Tauri CLI 作为 Bun workspace 的锁定开发依赖；
2. 桌面壳不注册 plugin、Rust command 或 invoke handler，默认 capability 为零权限；
3. Workbench 生产构建可作为 `frontendDist`；
4. doctor 可执行地检查配置与权限边界；
5. 在本机运行真实 Rust/Tauri release 构建；
6. 记录耗时、工具调用、失败修正、人工干预和剩余平台风险。

## 使用模型与人工干预

- 实现模型：GPT-5 Codex；
- 云模型/媒体 Provider：未调用；
- 人工干预：无；
- 子代理：用于本机工具链审计和 Tauri scaffold 架构独立研判，代码修改与最终验证由主代理完成。
