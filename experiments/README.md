# Experiments

每个实验使用独立目录，至少包含：

- `task.md`：原始任务与验收条件；
- `environment.md`：CodeArts版本、模型、系统和工具配置；
- `result.md`：耗时、工具调用、人工干预、测试结果和结论；
- 必要的输入、日志摘要或补丁。

涉及多个客户端或模型的对照实验应额外提交机器可读的任务定义与记录，并使用 `@gameforge/benchmark` 的 `definitionFingerprint` 证明输入等价。不同 Task/Run ID 是正常隔离，不能用名称相似代替任务指纹，也不能把 Provider 限流当作客户端工作流质量结论。

不得提交账号凭据、完整会话隐私数据或未经脱敏的日志。
