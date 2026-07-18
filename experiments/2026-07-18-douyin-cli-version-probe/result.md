# 实验结果

## 生产式正向探针

官方 tarball 源码检查确认 npm `bin.tmg` 指向 `bin/tmg.js`，Commander 的 `-V, --version` 只输出当前 CLI 版本；名为 `version [entry]` 的子命令则描述为“Get latest released version of project”并进入项目/平台逻辑。实现因此固定 Node + `bin/tmg.js --version`，不使用 `.cmd`、shell 或项目 `version` 子命令。

使用被 `.gitignore` 排除、具备严格 package identity 且只响应 `--version` 的本地无网络夹具，显式设置 `GAMEFORGE_DOUYIN_MINIGAME_CLI` 后依次执行：

```text
bun run doctor:douyin
bun run doctor
```

两条命令在同一次 8.3 秒墙钟窗口内退出 0。独立 doctor 返回：

- `configured: true`；
- `packageName: tt-minigame-ide-cli`；
- `binary: tmg`；
- `version: 2.1.1`；
- `executedArguments: [--version]`；
- `remoteOperations: forbidden`；
- `exposedArguments: [--version]`。

生产 Node stdio MCP doctor 注册 6 个工具，`engineering.douyinCliProbe: true`，并真实调用一次 capability 工具和一次 `get_douyin_mini_game_cli_status`，均成功。五个外部 Provider 的 `ready` 全为 `false`。被忽略夹具在命令后删除，没有进入 Git 状态。

## 负向与安全证据

`@gameforge/minigame-validator` 测试使用真实 Node 子进程证明：

- 只发送 `--version` 参数；`tmg version` 属于线上项目版本查询，未调用；
- 敏感环境变量不会传给子进程；
- `tt-ide-cli` 0.1.33 会因 package identity/version/bin 不匹配失败；
- 错误 `bin.tmg` 映射、非零退出和夹带额外 stdout 的版本输出都会失败；
- 相对路径、非官方 `bin/tmg.js` 形状和越界 timeout 在 spawn 前拒绝；
- 不退出的探针会在 500 ms 测试上限后终止。

MCP 测试证明 probe 异常只返回稳定的 `douyin_cli_probe_failed`，不泄露本机路径或错误正文；工具带 read-only、idempotent、closed-world annotations。未配置时 capability 保持 false 且工具不注册。`set-config`、`build-npm`、`preview` 和 `upload` 没有对应 MCP 参数或工具，因此 CodeArts 无法经该适配器触发它们。

## 结论

GameForge 现在能让 CodeArts 确认正确的小游戏 CLI 版本，但不会把“CLI 可发现”冒充 DevTool 编译、模拟器或真机证据。未配置 `tmg` 仍是允许状态：LayaAir 3.4.0 构建、无渲染玩法验证与离线包校验继续构成当前 no-GUI 本地闭环。

剩余平台缺口只有需要 GUI 的抖音开发者工具本地导入/编译器/模拟器验证。由于真机二维码依赖会上传代码的 preview，当前策略下不执行。

## 最终门禁

- `bun install --frozen-lockfile`：200 installs / 282 packages，无变更；
- `bun run check`：通过；
- `bun run test`：383 项测试通过；
- `bun run build`：通过；
- `bun run bundle:check`：game 与 Workbench 均无预算问题；
- `bun run audit`：无已知生产依赖漏洞；
- `bun run doctor:douyin`：未配置平台 CLI 时 `ok: true`，明确显示 optional probe；
- 隔离无可选能力环境的 `bun run doctor`：`ok: true`，五个外部 Provider 均为未配置；
- `bun run doctor:browser`：系统 Chrome 启动/关闭探针通过；
- `bun run doctor:desktop`：零权限、零 plugin、Workbench 构建门禁通过。

另验证了负向行为：若继承了 Run Relay URL 但 8787 未运行，生产 doctor 返回 `Configured Run Relay failed the bounded task-list probe.`，不会把半配置环境误报为健康。
