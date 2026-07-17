# Tauri 2 桌面壳

更新日期：2026-07-18

`apps/desktop` 是现有 React Workbench 的最小 Tauri 2 容器。它不承载 CodeArts/OpenCode Agent 循环，也不复制 MCP、Relay 或 TUI controller；桌面窗口仍通过 Workbench 已有 HTTP/SSE 协议观察 Run 状态。

## 当前边界

- `frontendDist` 指向 `apps/workbench/dist`，开发地址固定为 `127.0.0.1:4173`；
- 默认 capability 的 `permissions` 为空；
- Rust 入口没有自定义 command、invoke handler 或 plugin；Tauri 自身的内部 IPC transport 仍属于框架运行时；
- `bundle.active` 为 `false`，当前命令不会生成未签名安装包；
- CSP 只允许本地资源、Tauri IPC 内部 origin 和 loopback Relay/预览；
- 文件系统、shell、剪贴板、通知、下载、摄像头、麦克风和位置能力均未启用。

这意味着第一版只能提供桌面窗口，不提供原生系统集成。未来每增加一种 Tauri plugin，都必须先说明用途、收窄 capability scope，并增加 doctor 与平台验收。

## Bun 命令

```bash
bun install --frozen-lockfile
bun run desktop:check
bun run doctor:desktop
```

`desktop:check` 只执行 TypeScript 检查、doctor 单测和静态桌面配置检查，不要求 Rust 工具链。`doctor:desktop` 会先构建 Workbench，再确认桌面配置和权限边界；它不能替代 Tauri CLI Schema 与 Cargo 编译验证。

Windows release 可执行文件验证需要 Rust MSVC toolchain、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。进入已初始化的 MSVC x64 开发终端后运行：

```bash
bun run desktop:build
```

该脚本调用仓库锁定的 Tauri CLI，并附带 `--no-bundle`。成功产物位于 Cargo `target/release`，该目录是本地构建缓存且被 `.gitignore` 排除。不要提交或分发该未签名产物。

## 图标

可审计的源图是 `apps/desktop/icon.svg`。Tauri 所需的 PNG、ICO、ICNS 和移动平台尺寸由仓库本地 CLI 生成：

```bash
bun tauri icon apps/desktop/icon.svg --output apps/desktop/src-tauri/icons
```

`src-tauri/icons/` 和 `src-tauri/gen/schemas/` 是需要版本管理的 scaffold 输出：前者供各平台构建使用，后者供 capability 配置编辑器和 Schema 校验引用；只有 `src-tauri/target/` 是忽略的本地构建缓存。

## 已验证与未验证

2026-07-18 已在 Windows 11 上完成真实 release 编译，使用 Rust/Cargo 1.88.0、MSVC 14.44、Windows SDK 10.0.26100、WebView2 150 和 Tauri CLI 2.11.4。构建没有打包、签名、发布或连接云 Provider。

尚未验证：macOS/Linux 原生构建、安装器、代码签名、自动更新、平台 WebView 的自定义响应头，以及任何原生 plugin 权限。详细过程见 `experiments/2026-07-18-tauri-desktop-spike/result.md`。

## 官方依据

访问日期：2026-07-18。

- [Tauri：在现有前端项目中配置](https://v2.tauri.app/start/create-project/)
- [Tauri：前置依赖](https://v2.tauri.app/start/prerequisites/)
- [Tauri CLI](https://v2.tauri.app/reference/cli/)
- [Tauri 项目结构](https://v2.tauri.app/start/project-structure/)
- [Tauri capability](https://v2.tauri.app/security/capabilities/)
