# 结果

## 结论

抖音开发者工具 4.5.4 可以从实际用户扩展目录 `%USERPROFILE%\.douyin-ide\extensions` 加载 GameForge 本地桥接扩展。真实 DevTool Extension Host 已完成带令牌的 `hello/status` 握手，并响应控制端发送的 `getStatus` 请求，因此本实验的扩展通信入口验证通过。

内置 Code OSS CLI 版本为 `1.103.2-douyin`。通过安装包内 `@byted-tila/vscode/out/out/cli.js` 将 `gameforge.gameforge-douyin-devtool-extension@0.1.0` 安装到 `.douyin-ide\extensions` 后，当前小游戏工作区加载扩展并连接 `127.0.0.1:47653`。控制端验证了令牌但没有记录令牌值，随后发送带 `requestId` 的 `getStatus`；扩展返回：

- 当前 `release/bytedancegame` 工作区路径；
- `capabilities: ["workspace-status"]`（首次真实握手版本）；
- `remoteOperations: "forbidden"`。

随后发现 DevTool 通过动态 loopback 端口暴露标准 CDP target 列表，其中 `MiniApp Webview` 的子执行上下文包含 `tt`、`GameGlobal` 和游戏 Canvas。首次实例端口为 `8350`；DevTool 重启后端口变为 `8311`，用户数据目录的 `DevToolsActivePort` 第一行同步记录新端口。探针现优先读取显式配置，否则安全读取该文件第一行自动发现端口。两次只读 `runtime-smoke` 均实际通过：发现 2 个执行上下文，Canvas 内部分辨率为 1179×2556、CSS 尺寸为 393×852；`Page.captureScreenshot` 返回非空 PNG，探针只输出字节数与 SHA-256，不保存图像。

扩展协议现已增加 `runtime-status` 能力和有界的 `getRuntimeStatus` 请求，通过固定只读表达式报告 target、执行上下文、Canvas 和 viewport。自动化 TCP 测试覆盖 `getRuntimeStatus/runtimeStatus` 往返；更新后的 VSIX 已安装到 `.douyin-ide\extensions`，并在真实 Extension Host 中完成端到端验证。

2026-07-20 的最终复测中，控制端认证 `hello` 后发送带 `requestId` 的 `getRuntimeStatus`，并收到对应 `runtimeStatus`。响应返回 `available: true`，target 为 `MiniApp Webview`，执行上下文数量为 2；游戏上下文 `readyState` 为 `complete`，`tt` 与 `GameGlobal` 均存在，Canvas 内部分辨率为 1179×2556、CSS 尺寸为 393×852，viewport 为 393×852，`remoteOperations` 为 `forbidden`。短时 rendezvous 文件在扩展读取后已删除。

## 验证命令

```powershell
bun run --filter gameforge-douyin-devtool-extension check
bun run --filter gameforge-douyin-devtool-extension test
bun run --filter gameforge-douyin-devtool-extension build
bun run --filter gameforge-douyin-devtool-extension runtime-smoke
bun run check
```

扩展检查结果：TypeScript 严格检查通过；Vitest 2 个测试文件、6 个测试通过；构建通过。测试覆盖协议边界、短时 rendezvous、TCP `hello/status/getStatus/getRuntimeStatus` 往返和连接状态变化。真实只读 Runtime smoke 通过。

2026-07-20 后续实现增加固定 `runtimeAction` 白名单：`reload`、视口内单点 `tap`、截图摘要和最长 5 秒的 `collectConsole`。协议拒绝任意 `evaluate`、越界坐标和超时采集窗口；截图仅返回字节数与 SHA-256，控制台最多返回 64 条、每条最多 512 字符。BridgeClient 的 TCP 往返测试已覆盖 `runtimeActionResult`，TypeScript 严格检查、Vitest（2 个文件、6 个测试）及扩展构建通过。

真实 DevTool 当前会话中，直接执行 `collectConsole(500ms)` 成功并返回空数组；随后 `Page.captureScreenshot` 在 5 秒内未响应。实现现已为目标列表、WebSocket 握手和每条 CDP 请求设置确定性超时，因此该失败会明确返回而不会挂住主 Agent。此前同一环境已取得非空截图摘要，但本次截图不可重复，故不把本轮截图 action 记录为通过。`reload` 与 `tap` 会改变模拟器状态，本轮未对用户当前项目自动执行。

真实 DevTool 探针结果：令牌校验通过，扩展版本为 `0.1.0`，`devtool` 为 `douyin`，工作区状态与带 `requestId` 的 Runtime 状态响应均通过。扩展状态栏连接状态同步问题也已修正，不再在 socket 已连接后持续显示 `connecting`；可从 DevTool 的“查看 → 命令面板”执行连接命令，规避 DevTool 占用 `Ctrl+Shift+P` 的快捷键冲突。

## 人工干预与工具调用

- 用户打开并保持抖音开发者工具与既有小游戏工作区；
- 使用 Windows GUI 自动化从 DevTool 命令面板执行 `GameForge: Connect Local Bridge`；
- 本地监听器只绑定 `127.0.0.1`，使用短时令牌并验证双向报文；
- 验证结束后，短时 rendezvous、监听端口和临时 VSIX 均不存在；
- 未点击或调用 preview、真机调试、性能测试、上传、分享、抖音云、提审或发布入口。

## 剩余风险

- 标准 CDP target、只读 Runtime 探针以及真实 Extension Host 的 `getRuntimeStatus` 往返均已验证；
- 当前只覆盖 Runtime 存活、Canvas、viewport 和截图摘要；Console 断言、生命周期与确定性输入测试仍未实现；
- 内置 CLI 与 `.douyin-ide\extensions` 属于当前 4.5.4 的实测行为，未来版本可能变化，启动时应做版本与能力探针；
- 扩展保持最小权限，只允许 `getStatus` 和只读 `getRuntimeStatus`，不得把 preview、上传、提审或发布加入自动化工具面。
