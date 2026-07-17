# 实验结果

日期：2026-07-18

## 实现结果

`ProjectAssetStore.store` 新增默认 `create` 与显式 `replace`。替换要求 non-negative `expectedRevision`，只按 provenance assetId 查找；角色未传时沿用原角色，传入时仍执行全 Manifest 唯一性与媒体类型校验。锁内二次 CAS 后验证旧媒体的句柄、路径、字节数和双 SHA-256，再生成 revision +1 的完整 Manifest。

文件提交使用同卷临时文件和硬链接 no-replace 发布，不覆盖 Manifest 外的竞态文件。替换先备份旧媒体，再发布新媒体与 Manifest；普通异常会继续尝试全部清理与旧文件恢复，并用 `AggregateError` 保留原错误及额外回滚错误。不同 MIME 导致路径变化时，成功后旧路径消失。

三个媒体落盘 MCP 工具都接受 `mode`/`expectedRevision`。Seedream 与 Freesound 在 Provider 前读取 Manifest 预检；TTS provider 新增不联网的签名句柄 `inspect`，素材化替换先取得绑定 assetId 再预检。存储层仍做权威 CAS，因此预检与最终写入之间的并发变化也会拒绝。

`asset.ready` 无需新增事件类型：Workbench 已按 assetId 替换旧 entry；刷新 iframe 会重启模板并重新 fetch `assets/manifest.json`。

## 已知边界

普通 Promise/文件系统错误已回滚，但 Node 不提供跨媒体文件与 Manifest 的单一原子事务。进程在两个切换之间被强制终止或机器断电时可能遗留 `.bak`/`.tmp`；当前没有声称 kill -9/断电崩溃原子性，后续应增加持久化事务日志和启动恢复。

## 测试结果

```text
bun install --frozen-lockfile   # 198 installs，无变更
bun run check
bun run test                    # 256 tests passed
bun run build
bun run bundle:check
bun run doctor                  # ok: true
bun run doctor:browser          # ok: true
bun run doctor:desktop          # ok: true
bun run audit                   # 0 vulnerabilities
git diff --check
```

以上命令均在最终工作树实际通过。Asset Store 1 个文件 12 项测试，MCP 5 个文件 35 项测试，Provider 6 个文件 41 项测试。新增覆盖同 assetId 跨 JPEG/PNG 路径替换、revision CAS、旧路径清理、Manifest 外目标不覆盖、图片 stale 在 Provider 前拒绝、TTS signed-handle inspect 不联网以及 voice stale 在下载前拒绝。文件系统故障注入和强制进程终止恢复仍属于上述已知边界。Vite 的既有 Phaser 异步 chunk 通用提示仍存在，版本化 bundle 预算通过。
