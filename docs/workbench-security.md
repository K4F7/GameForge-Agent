# Workbench 与桌面壳安全边界

更新日期：2026-07-18

Workbench 将生成游戏视为不可信内容。`preview.ready` 通过 RunEvent Schema 只证明 URL 格式合法，不代表该 origin 已获得界面授权。

## 预览策略

- loopback HTTP：允许 `localhost`、`127.0.0.1`、`[::1]` 的任意端口，支持受控本地预览；
- 远程预览：必须使用 HTTPS，且 exact origin 出现在 `VITE_GAME_PREVIEW_ORIGINS`；
- 未授权事件 URL：自身不会进入 iframe 或新窗口链接，界面改为加载已授权的 `VITE_GAME_PREVIEW_URL` 并显示原因；
- URL 不得携带用户名、密码或 fragment；远程 origin 配置不得包含 path、query；
- iframe 保持 opaque origin，仅授予 scripts 和 pointer lock，不授予 same-origin、forms、popups、top navigation 或 fullscreen；
- 新窗口链接使用 `noopener noreferrer`。

## CSP 与响应头

Vite 构建把同一 allowlist 写入 CSP meta；开发与 `vite preview` 同时发送 CSP、`Permissions-Policy`、`Referrer-Policy: no-referrer` 和 `X-Content-Type-Options: nosniff`。生产 Web 服务器或未来桌面壳必须发送同等或更严格的响应头，因为 `frame-ancestors` 不能依靠 meta 生效。

CSP 不允许任意远程 frame。`connect-src` 只包含 self、loopback 和配置的 Relay origin。摄像头、麦克风、地理位置、支付和 USB 默认关闭。

## 威胁与缓解

| 威胁 | 当前缓解 | 剩余边界 |
|---|---|---|
| 恶意 `preview.ready` 指向钓鱼站 | exact-origin allowlist、sandbox、noopener | Relay/Agent 身份认证仍由部署层负责 |
| 生成游戏读取 Workbench DOM/存储 | 不启用 `allow-same-origin` | iframe 内脚本仍可消耗 CPU 和访问其 CSP 允许的网络 |
| 顶层跳转、弹窗、表单或全屏诱导 | sandbox 不授予对应权限 | 用户仍可显式点击受控的新窗口链接 |
| Relay/预览 URL 泄露凭据 | URL Schema 和配置拒绝 credentials | 密钥不得放入任何 `VITE_*` 变量 |
| 桌面壳读取任意文件 | 当前没有桌面文件 API | Tauri spike 只能授权 app config/cache，禁止通用文件系统 scope |
| 本地服务暴露到局域网 | Vite 固定绑定 `127.0.0.1` | Relay 与 Preview Manager 仍需各自保持 loopback 绑定 |

## Tauri 进入条件

Tauri 第一版不得新增 shell、任意文件系统、剪贴板、摄像头、麦克风、位置或下载权限。只允许加载打包后的 Workbench、连接明确 Relay origin、嵌入上述预览 allowlist。安装包签名、自动更新公钥和三平台 WebView CSP 行为必须另建实验验证；这些条件未满足前，本仓库仍以 Web Workbench 与 Bun TUI 为交付面。

Tauri 实现时应把 CSP 写入 `tauri.conf.json` 的 `app.security.csp`，让构建过程为本地脚本和样式加入 nonce/hash。项目锁定的 Tauri CLI 2.11.4 Schema 尚不接受 `app.security.headers`，因此 Permissions-Policy 等自定义协议响应头必须留到平台 WebView 验收阶段选择受支持机制；不能绕过 Schema 或把 Vite 开发服务器配置直接复制成桌面权限。

## 官方依据

访问日期：2026-07-18。

- [Vite server.headers](https://vite.dev/config/server-options.html#server-headers)
- [Vite preview.headers](https://vite.dev/config/preview-options.html#preview-headers)
- [MDN CSP 指南](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [MDN frame-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src)
- [Tauri 2 CSP](https://v2.tauri.app/security/csp/)
- [Tauri 2 Security 与 Trust Boundaries](https://v2.tauri.app/security/)
- [Tauri 2 HTTP Headers](https://v2.tauri.app/security/http-headers/)
