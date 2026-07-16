# Run Relay 重启恢复实验

## 目标

让 Workbench Task、RunEvent、游标和终态在可选本地状态文件启用时跨正常 Relay 进程重启恢复，避免长时间 Seedream/TTS 工作流因 Relay 重启必然丢失。

## 验收条件

1. 默认不配置时保持内存模式；
2. 只接受绝对状态文件路径；
3. 快照写入串行化并采用临时文件同步后 rename；
4. 恢复前验证 Schema、事件连续性和 Task/Run 终态一致性；
5. 真实生产 Relay 在认领并发布事件后重启，可恢复 Task 和游标；
6. 完成后再次重启，可恢复 completed 终态。
7. 真实浏览器 SSE 在 Relay 重启后自动重新打开，Workbench 能忽略回放重复事件并恢复 connected 状态。
