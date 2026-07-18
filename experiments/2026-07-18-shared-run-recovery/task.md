# 实验任务

把 Workbench 与 Bun TUI 的 Run 回放、序列连续性、终态和有限重试语义抽为共享控制器，同时保留浏览器 EventSource 与 Bun fetch stream 的传输差异。验证断线、跳号、EOF、过期游标和中止，不引入 Agent 循环。
