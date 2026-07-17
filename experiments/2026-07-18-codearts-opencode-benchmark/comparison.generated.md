# client-safety-game-v1 客户端基准报告

- 同一任务定义：是
- 工作流质量可比较：否
- 结论：任务定义相同，但至少一个客户端未完成；只能比较启动与失败边界，不能比较工作流质量。

| Client | Version | Model | Status | Events | Tools | Errors | Human | Failure | Verification |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| codearts | 26.6.2 | — | completed | 6 | unknown | unknown | 3 | none | won/pass |
| opencode | 1.18.3 | deepseek-v4-flash-free | stopped | 2 | 0 | 0 | 0 | rate-limit | — |

不同 Task ID/Run ID 是预期行为；`definitionFingerprint` 才是同任务判据。凭据、会话正文和完整本地日志不属于基准记录。
