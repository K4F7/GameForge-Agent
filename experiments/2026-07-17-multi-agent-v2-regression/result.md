# Multi-agent v2 回归诊断结果

## 结论

当前故障与 0.144.5 升级高度相关，但不能归因于 `codex.exe` 单一文件。历史 0.144.4 v2 子线程绝大多数成功；当前即使显式使用保留的 0.144.4 可执行文件，v2 子线程仍会在本机服务上断流。更准确的故障范围是“0.144.5 桌面运行时/本地 API 服务或新版模型目录参与的 v2 子线程路径”。

WebSocket 不能作为规避方案。本机服务明确返回 `400 websocket_disabled`；当前只能使用 SSE。`luna` 的 v1 生命周期在 SSE 下正常，证明基础子代理存储、模型推理和 SSE 并未整体失效。

## 历史日志统计

数据源：`%USERPROFILE%\.codex\state_5.sqlite` 的 `threads`、`thread_spawn_edges`，以及对应 rollout JSONL 的 `task_complete.last_agent_message`。实验只记录聚合统计，不提交数据库或完整私有会话。

| CLI | 带 `agent_path` 的 v2 子线程 | 非空最终消息 | 空最终消息 | 无完成事件 |
| --- | ---: | ---: | ---: | ---: |
| 0.144.4 | 486 | 478 | 7 | 1 |
| 0.144.5 | 8 | 0 | 8 | 0 |

- 最近三个真实成功样本均创建于 2026-07-16 15:41:57 至 15:41:58，父模型为 sol，子模型为 luna，CLI 0.144.4，`multi_agent_version=v2`，`comp_hash=2911`。
- 当前失败样本的父模型为 sol 或 terra，实际子线程模型仍为 luna，CLI 0.144.5，`multi_agent_version=v2`，`comp_hash=3000`。
- 失败子线程收到任务并消耗令牌，但 `task_complete.last_agent_message=null`；父线程报告 `stream disconnected before completion: stream closed before response.completed`。
- 桌面 0.144.5 二进制时间为 2026-07-16 16:12:09；当前 cockpit 模型目录于 2026-07-17 03:00:48 更新。

## 实时矩阵

| 场景 | 结果 | 耗时 | 关键证据 |
| --- | --- | ---: | --- |
| sol / 0.144.4 / WS 关 / v2 | 失败 | 42.8 秒 | 子线程连接完成前断开 |
| sol / 0.144.5 / WS 关 / v2 | 失败 | 58.5 秒 | `stream disconnected before completion` |
| terra / 0.144.4 / WS 关 / v2 | 失败 | 41.0 秒 | 子线程连接完成前断开 |
| terra / 0.144.5 / WS 关 / v2 | 失败 | 既有复测 52.4 秒 | 同类流断开；一次中文 stdin 编码异常不计结果 |
| luna / 0.144.4 / WS 关 / v1 | 通过 | 27.8 秒 | `spawn_agent -> wait -> close_agent`，返回 `CHILD_OK` |
| luna / 0.144.5 / WS 关 / v1 | 通过 | 40.5 秒 | `spawn_agent -> wait -> close_agent`，返回 `CHILD_OK` |
| luna / 0.144.5 / WS 关 / v1 完整生命周期 | 通过 | 82.9 秒 | 双并发、等待、关闭、恢复、二次输入、再次关闭全部成功 |
| sol/terra / 两版本 / WS 开 | 失败 | 每格约 13 秒 | 根请求阶段即返回 `400 websocket_disabled`，尚未派生 |

另做了跨模型对照：以 luna/v1 为根控制器并行派生 sol 与 terra，两个子代理分别返回 `SOL_CHILD_OK` 和 `TERRA_CHILD_OK`，总耗时 45.7 秒。这排除了 sol/terra 模型普通推理不可用的可能，故障集中在 v2 控制器路径。

## 配置发现

- 三个模型目录项均为 `tool_mode=code_mode_only`。
- v2 的 `non_code_mode_only=true` 会隐藏协作工具；显式设为 `false` 后能注册 v2 工具。
- `tool_namespace=agents` 与 `tool_namespace=collaboration` 都能注册 v2 工具，二者都会到达同一个子线程断流故障，因此命名空间不是根因。
- `supports_websockets=true` 会请求 `ws://localhost/.../responses`，服务返回 `websocket_disabled`。持久配置应继续保持 `false`。
- 旧目录 `comp_hash=2911` 的单独覆盖测试因缺少当前协作命名空间定义而返回 `unknown MCP server 'collaboration'`，不能作为等价回滚验证。

## 工具调用

- 日志取证：`sqlite3` 查询 `threads`、`thread_spawn_edges` 和日志 schema；`rg`、PowerShell 定点读取 rollout 事件。
- 版本取证：分别执行两个本地 `codex.exe -V`。
- 会话测试：`codex exec --ephemeral --json`，只读沙箱，使用配置覆盖切换 CLI、WS、命名空间和 code-mode 限制。
- 真实协作事件：v1 覆盖 `spawn_agent`、`wait`、`close_agent`、`send_input` 和恢复；v2 覆盖派生、等待、列举和中断路径，但子线程未产生最终消息。

## 剩余风险

- 0.144.4 可执行文件连接的仍是当前本地 API 服务，因此“旧 exe 当前也失败”不能排除桌面服务端回归。
- 历史成功目录文件已被更新，没有保存完整的 2911 cockpit 目录快照，无法做完全相同输入的离线回放。
- 当前 v2 会留下 `open` 且无最终消息的子线程记录；继续高并发测试会增加日志与令牌消耗，没有进一步诊断价值。
