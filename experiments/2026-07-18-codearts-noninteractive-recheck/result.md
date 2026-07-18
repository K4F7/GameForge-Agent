# CodeArts 非交互 OAuth 复核结果

- `codearts.exe --version` 仍输出 `26.6.2`；升级后可执行文件没有显示新版本；
- `run --help` 仍提供 message、`--format json`、agent/model/session/attach 等参数；
- 创建本地 Task `task-31c26689-e97d-43af-84b6-2c21de7f3f16` 与 Run `codearts-noninteractive-20260718` 后，通过仓库启动器实际执行 `codearts run --format json`；
- 进程约 2.6 秒退出且退出码为 0，但标准输出明确报告认证失败：未设置 `CODEARTS_CLI_AK`/`CODEARTS_CLI_SK`，要求在华为云 IAM 申请 AK/SK；
- OAuth TUI 登录仍未被非交互 `run` 复用；没有认领 Task、启动 MCP 或调用模型/工具；
- 测试 Run 已显式发布 sequence 2 `run.stopped`，Task 同步为 stopped；临时 Relay/Workbench 子进程已关闭；
- 本实验不记录 AK/SK、OAuth 数据、私人会话或完整环境。

结论：真实 CodeArts 非交互基准仍需用户另行授权 CLI AK/SK；在此之前只能由用户操作 OAuth TUI，不能自动宣称已完成新一轮真实 CodeArts 执行。
