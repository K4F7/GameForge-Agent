# 实验任务

在不启动抖音开发者工具、不调用平台 CLI、不产生任何远程状态的前提下，为已通过 LayaAir 构建的小游戏产物生成可重复、机器可读的本地交付清单。

验收条件：

- Bun 编排正式 Node CLI；stdout 可直接作为 JSON 管道输入；
- validator 前后各生成一次逐文件 SHA-256 快照，聚合摘要必须一致；
- 输出仅含相对路径、字节数和哈希，不含本机绝对路径、日志或环境变量；
- 明确记录 `remoteOperations: forbidden` 与 `devToolVerification: not-run`；
- MCP build 响应复用完整清单，`build.ready` 与 TUI 只投影有界摘要；
- 不登录，不执行 `tmg open`、preview、上传、提审或发布。
