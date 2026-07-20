# 实验结果

日期：2026-07-18

## 结果摘要

新增 `apps/desktop`，以 Tauri 2 封装现有 Workbench。默认 capability 为零权限，Rust 壳没有自定义 command、invoke handler 或 plugin；Tauri 框架内部 IPC transport 仍存在。`bundle.active=false`，只验证不打安装包的 release 可执行文件。

Windows 真实构建最终通过：

```text
Finished `release` profile [optimized]
Built application at: apps/desktop/src-tauri/target/release/gameforge-desktop.exe
```

该产物属于忽略的本地 Cargo 构建缓存，未提交、未签名、未发布。

## 环境

- Bun：1.3.14 或更高（仓库要求）；
- Tauri CLI：2.11.4，作为根 workspace 的精确版本开发依赖；
- Rust/Cargo：1.88.0，已有 MSVC toolchain；
- Visual Studio 2022 Community，MSVC 14.44；
- Windows SDK：10.0.26100；
- WebView2：150.0.4078.65；
- 操作系统：Windows 11。

## 过程与工具调用

1. 审计本机 Rust、MSVC、Windows SDK 与 WebView2；Rust 未在普通 shell 的 `PATH`，但稳定 MSVC toolchain 已安装；
2. 查阅 Tauri 2 官方现有前端、前置依赖、CLI、项目结构和 capability 文档；
3. `bun add -D @tauri-apps/cli@2.11.4` 前两次因 registry 连接关闭失败，第三次成功；
4. 第一次 `tauri build --no-bundle` 在配置 Schema 阶段拒绝当前 CLI 尚不支持的 `app.security.headers`，删除该字段并把响应头验证列为后续平台实验；
5. 第二次构建进入 Rust 编译后因缺少 Windows `icons/icon.ico` 失败，使用 `bun tauri icon` 从版本化 SVG 生成标准图标；
6. 第三次构建成功，最后一次耗时 51.4 秒；此前下载并编译依赖的失败尝试耗时 95.7 秒；
7. `doctor:desktop` 静态检查 Workbench 构建、CSP、loopback 地址、零权限、零 plugin 和零自定义 command 注册；Tauri Schema、Cargo 与图标由真实构建验证。

所有命令均由 Bun 编排；MSVC 环境通过 Visual Studio 的 `vcvars64.bat` 初始化。没有调用云 API，也没有读取或输出任何密钥。

## 最终验证

以下命令均在本次改动完成后实际通过：

```text
bun install --frozen-lockfile
bun run check
bun run test                 # 219 tests passed
bun run build
bun run bundle:check
bun run doctor
bun run doctor:browser
bun run doctor:desktop
bun run audit                # 0 vulnerabilities
git diff --check
```

另已在同一工作树执行 `bun run desktop:build`，真实 Windows release 构建通过。Phaser 异步游戏块仍会触发 Vite 的 500 kB 通用警告，但仓库的 initial、async 与 total raw/gzip 预算全部通过。

## 安全边界

- CSP 不允许 `unsafe-eval` 或任意远程 origin；
- 只允许 loopback Relay/预览连接与 iframe；
- 没有文件系统、shell、剪贴板、通知、摄像头、麦克风或位置权限；
- 没有安装器、签名、自动更新或远程发布；
- Tauri CLI 2.11.4 Schema 不接受 `app.security.headers`，因此桌面自定义响应头尚未声称通过。

## 剩余风险

- 仅在 Windows 完成真实构建，macOS/Linux 尚未执行；
- 未验证三平台 WebView 对 CSP、iframe 和自定义响应头的行为；
- 未设计安装包签名、更新密钥保管、发布和回滚；
- 尚未加入任何原生系统能力，后续启用 plugin 必须逐项收窄权限并增加测试。
