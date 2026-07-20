# 结果

## 结论

状态：通过。新 bundle 已在真实 DevTool Extension Host 中激活，并通过本地 Bridge Host 完成工作区状态、Runtime 状态、Console 与截图动作的端到端验收。

现有手写 WebSocket/CDP pending-map 已替换为固定版本的 `chrome-remote-interface` 适配层，命令和事件使用 `devtools-protocol` 强类型，但对外仍只暴露原有 Runtime、Page 与 Input 白名单。扩展入口使用 esbuild 打成自包含 CommonJS 文件，避免依赖 DevTool Extension Host 是否提供全局 `WebSocket`。

真实 DevTool 4.5.4 Runtime smoke 返回：

- target：`MiniApp Webview` / `webview`；
- execution context：2 个；
- `tt`、`GameGlobal`：存在；
- Canvas：1179×2556，CSS 393×852；
- viewport：393×852；
- 截图摘要：58,586 字节，SHA-256 `0b604695c148e1861d838682dd3ab27efbb9e496595cd79cc52c8cd3559bc0d2`。

真实 Extension Host 与 Bridge Host 端到端 smoke 返回：

- Extension：`gameforge.gameforge-douyin-devtool-extension` 0.1.0；
- workspace：`.gameforge-validation/generated-v12-final/douyin-arcade-012-final/release/bytedancegame`；
- bridge：`listening=true`、`connected=true`；
- Runtime：`available=true`，target 为 `MiniApp Webview`，2 个 execution context；
- `collectConsole`：成功，返回空数组；
- `screenshot`：成功，12,502 字节，SHA-256 `441eca9e095cad6797177bdeee127a755d70d7dc5af302bf06d082b922a32c90`。

本次环境中 `Page.captureScreenshot` 连续 5 秒无响应。实现随后使用扩展内固定的 `canvas.toDataURL('image/png')` 表达式回退，成功取得 PNG 摘要；不保存图片，也不接受调用方 JavaScript。真实 `collectConsole(500ms)` 同样通过并返回空数组。

## 鲁棒性增强

- 校验 `/json/list` 结构、target 字段、类型和 loopback WebSocket URL；同优先级多个 target 明确失败；
- target 列举、连接、命令和关闭分别设置超时，连接超时后的晚到 client 会自动关闭；
- 跟踪 execution context 创建、销毁和清空，等待 context 稳定后再探测；
- 单个失效 context 不再使整个 Runtime 状态失败；
- 直接调用 Runtime action 时再次校验坐标和 Console 时长；
- viewport、Runtime 返回值、Base64 和 PNG 签名均经过边界校验；
- Console 最多 64 条、每条 512 字符，无法 JSON 序列化的值不会使监听器崩溃；
- smoke 握手对畸形 JSON、socket 提前结束和非零子进程退出给出确定性错误并清理。

## 验证命令

```powershell
bun run --filter gameforge-douyin-devtool-extension check
bun run --filter gameforge-douyin-devtool-extension test
bun run --filter gameforge-douyin-devtool-extension build
bun run --filter gameforge-douyin-devtool-extension runtime-smoke
bun run douyin:host-smoke
bun run check
bun audit --prod
```

结果：扩展 5 个测试文件、19 个测试通过；扩展构建通过；仓库全部 TypeScript 检查通过；生产依赖审计无已知漏洞；真实 Extension Host/Bridge Host smoke 通过。打包 dry-run 包含 9 个文件，解包大小约 1.22 MiB，第三方许可证已记录。

## 人工干预与限制

- 隔离 profile 的自动 Extension Host smoke 仍会被 DevTool 登录前置页阻断；CLI 并发实例也不会自动进入工作台。因此最终验收复用现有登录 profile，并通过桌面 UI 打开最近项目；
- 按用户确认关闭 DevTool 后，本地已安装扩展被替换为本次构建，替换前副本保存在 `%LOCALAPPDATA%\\Temp\\gameforge-douyin-extension-backup-1784571107778`；
- 初次验收发现 Bridge Host 是前一会话遗留进程，扩展发送状态后连接已失效；精确停止该进程并启动新 Host 后，扩展自动重连，端到端 smoke 通过；
- DevTool 当前保持打开，未执行 preview、上传、真机调试、提审或发布。

剩余限制仅是隔离 profile 的无人值守启动受登录页约束，不影响已登录真实工作台中的插件、Bridge 与 Runtime 能力。
