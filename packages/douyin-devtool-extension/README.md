# GameForge Douyin Bridge

这是一个面向抖音小游戏开发者工具的本地桥接扩展原型。它只连接 `127.0.0.1`，向 GameForge 报告扩展版本、工作区和活动文件，并接受有界的 `getStatus`、只读 `getRuntimeStatus` 与固定 Runtime action 请求。

`getRuntimeStatus` 只连接 DevTool 的 loopback CDP 端口，执行扩展内固定的只读表达式，报告 `MiniApp Webview`、`tt`、`GameGlobal`、Canvas 和 viewport；它不接受调用方提供的 JavaScript。扩展不暴露 `preview`、上传、提审或发布操作。连接可显式设置至少 32 字符的 `GAMEFORGE_DOUYIN_BRIDGE_TOKEN`，也可由本地控制端在系统临时目录创建 `gameforge-douyin-bridge.json`。后者必须包含 1024–65535 端口、32–256 字符随机令牌和不超过 60 秒的过期时间，扩展读取成功后立即删除；两种方式都只连接 `127.0.0.1`。

CDP 连接层使用固定版本的 `chrome-remote-interface` 与 `devtools-protocol` 类型定义，但只包装本扩展已有的 Runtime、Page 与 Input 白名单。连接器会验证 `/json/list` 结构、target 类型和 loopback WebSocket URL；多个同优先级 `MiniApp Webview` 会明确失败，不会随机控制某个模拟器。会话跟踪 execution context 的创建、销毁和清空事件，对 target 列表、连接、命令和关闭分别设置确定性超时，并在连接晚到或中途断开时清理资源。第三方许可证见 `THIRD_PARTY_NOTICES.md`。

点击编辑器状态栏中的 `GameForge: disconnected` 会执行本地连接命令。这样不依赖 DevTool 已占用的 `Ctrl+Shift+P` 快捷键。

```powershell
bun run --filter gameforge-douyin-devtool-extension check
bun run --filter gameforge-douyin-devtool-extension test
bun run --filter gameforge-douyin-devtool-extension build
```

构建后的 `dist/extension.js` 是自包含的 CommonJS 扩展入口；构建会把 CDP 客户端及其 WebSocket 实现打入该文件，只把 DevTool 提供的 `vscode` 模块保留为外部依赖，因此不再依赖 Extension Host 是否提供全局 `WebSocket`。真实 DevTool 加载实验必须使用隔离的用户数据和扩展目录，并单独记录 DevTool 版本、启动参数、人工干预和结果。

抖音开发者工具 4.5.4 的实测用户扩展目录是 `%USERPROFILE%\.douyin-ide\extensions`。可使用安装包内 Code OSS `cli.js` 的 `--extensions-dir` 与 `--install-extension` 安装 VSIX；`.vscode` 和 `.vscode-oss` 不是本版本 DevTool 实际扫描 GameForge 扩展的目录。该路径属于版本相关实现，集成代码必须先执行版本与加载能力探针。

设置 `GAMEFORGE_DOUYIN_DEVTOOL_EXE` 与安装包内 Code OSS `cli.js` 对应的 `GAMEFORGE_DOUYIN_DEVTOOL_CLI` 后，可运行 `bun run --filter gameforge-douyin-devtool-extension smoke`。探针会创建隔离的临时用户数据目录，以 extension development 模式启动 DevTool，只等待本地 `hello/status` 握手，随后关闭进程并删除临时目录。桌面 Vela 包装入口不会转发扩展 CLI 参数，因此探针以 Electron Node 模式调用安装包内 CLI。

隔离配置无法越过 DevTool 登录前置页时，可由用户显式设置 `GAMEFORGE_DOUYIN_SMOKE_USE_EXISTING_PROFILE=1`，复用当前 DevTool 配置并从系统临时目录加载本次构建的扩展；该模式不执行持久安装，但可能更新 DevTool 的最近项目记录。

若定制启动链不接受 development extension，可先用内置 CLI 将 VSIX 安装到隔离目录，再同时设置 `GAMEFORGE_DOUYIN_SMOKE_EXTENSIONS_DIR` 和 `GAMEFORGE_DOUYIN_SMOKE_USE_EXISTING_PROFILE=1`。探针只从该隔离扩展目录加载，不写 DevTool 安装目录。

Runtime action 仅允许 `reload`、视口内单点 `tap`、截图摘要和最多 5 秒的 `collectConsole`。截图优先调用 `Page.captureScreenshot`；若当前 DevTool 版本不响应，则在已经验证包含 `tt`、`GameGlobal` 和 Canvas 的执行上下文中运行扩展内固定的 `canvas.toDataURL('image/png')` 回退表达式。两条路径都只返回字节数与 SHA-256，日志最多 64 条且每条截断到 512 字符；协议不接受调用方 JavaScript、拖动、文件访问或远程平台操作。`reload` 与 `tap` 会改变模拟器状态，应由控制端在测试步骤中显式调用。

`GAMEFORGE_DOUYIN_SMOKE_PROJECT` 可指定一个已经过校验的本地 `release/bytedancegame` 目录，避免 DevTool 前置管理器把普通仓库目录拒绝为小游戏工程。

DevTool 运行并显示模拟器时，可执行只读 Runtime 探针：

```powershell
bun run --filter gameforge-douyin-devtool-extension runtime-smoke
```

探针优先使用显式 `GAMEFORGE_DOUYIN_CDP_PORT`，否则读取 DevTool 用户数据目录中的 `DevToolsActivePort` 第一行，动态发现本次启动的 loopback CDP 端口。随后选择 `MiniApp Webview`，验证 `tt`、`GameGlobal` 和 Canvas 执行上下文，并通过 Page 截图或上述固定 Canvas 回退只输出字节数与 SHA-256。它不读取 `DevToolsActivePort` 的第二行连接标识，不保存截图、不注入调用方代码，也不调用 preview、上传、提审或发布；点击/重载只通过上述固定 action 且不在该 smoke 命令中自动执行。
