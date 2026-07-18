# codearts-douyin-local-production 客户端基准报告

- 同一任务定义：是
- 工作流质量可比较：是
- 结论：所有客户端都完成了同一基准，可以比较工作流结果。

| Client | Version | Model | Status | Events | Tools | Errors | Human | Failure | Proof |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| codearts | 26.6.2 | huaweicloud-maas/deepseek-v3.2 | completed | 6 | 16 | 0 | 3 | none | mini:douyin-mini-game/pass |
| opencode | 1.18.3 | opencode/hy3-free | completed | 6 | 16 | 0 | 3 | none | mini:douyin-mini-game/pass |

不同 Task ID/Run ID 是预期行为；`definitionFingerprint` 才是同任务判据。凭据、会话正文和完整本地日志不属于基准记录。
