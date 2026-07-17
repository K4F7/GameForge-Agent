# 资产事件中断恢复结果

## 实现

- `ProjectAssetStore.read(projectId)` 返回严格 `RuntimeAssetManifest`；
- 读取前重新验证项目根、托管 manifest ID、public/assets 真实目录和 runtime manifest project ID；
- 每个 entry 对应文件必须是普通非符号链接文件，realpath 仍在 public 内且 `stat.size === entry.bytes`；
- 项目输出根配置后，生产 MCP 注册 `get_project_assets`，capability engineering 增加 `assetStore`；
- CodeArts 恢复时调用一次 Manifest 工具，按 asset ID 与 Relay 回放事件对账，以当前 revision 补发缺失 `asset.ready`，然后才决定是否调用媒体 Provider。

## 自动化证据

- Asset Store 真实存入图片后，read 返回 revision 1 和 player entry；将文件改成 1 byte 后，read 拒绝 `missing or inconsistent`；
- 完整本地工作流在 `request_image_asset` 已落盘、`asset.ready` 尚未发布的位置调用 `get_project_assets`，恢复同一 revision 1/player entry，然后继续发布事件；
- doctor 的 capability→工具映射要求 `assetStore: true` 时存在 `get_project_assets`。
- 真实 production doctor 配置绝对项目输出根与 Run Relay 后，六个工程能力全 true，17 个工具包含 `get_project_assets`，有界 Relay 探测通过；Relay PID 34928 随后停止且端口释放。

## 最终门禁

- 目标测试：Asset Store 5、MCP Server 29，全部通过；
- `bun run doctor`：基础环境与真实 output root + Relay 环境均通过；
- `bun run check`：通过；
- `bun run test`：164 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 仍有已知 500 kB 警告，不是失败；
- `bun install --frozen-lockfile`：171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过；
- 端口 4173、5173、8787：无残留监听。

## 边界

- 本实验当时的读取工具只验证文件边界与字节数，尚未重新计算 SHA-256；该历史边界已在 2026-07-18 的媒体完整性加固中关闭：恢复读取现在使用文件流逐项重算哈希，并同时比对 entry 与 provenance，详见 `../2026-07-18-media-integrity-hardening/result.md`；
- 当前 Asset Store 只追加、不删除，因此按 asset ID 对账成立；未来若增加替换/删除，需要新的资产生命周期事件。
