# 实验结果

日期：2026-07-18

## 结果摘要

资产恢复现在不再只相信文件大小。`ProjectAssetStore.read()` 打开文件句柄后核对路径与句柄的 device/inode、普通文件、非符号链接、realpath 和字节数，通过同一句柄流式计算 SHA-256，再复核哈希前后 stat 与路径身份稳定，并同时比对 `entry.sha256` 与 `entry.provenance.sha256`。新增测试把 JPEG 最后一个字节替换为不同值但保持原长度，恢复读取会稳定拒绝。

Freesound preview 不再调用 `response.arrayBuffer()`。实现使用 `ReadableStream` reader 累计分块，超过 16 MiB 时立即 `cancel()`；空响应和超限响应分别返回稳定错误。新增测试使用没有 `Content-Length` 的持续 chunked stream，确认越界后 reader 被取消。

## 工具调用与失败修正

1. 子代理只读审计定位 Asset Store 同尺寸篡改与 preview 一次性读取风险；
2. 主代理读取并修改 `store.ts`、`freesound-preview.ts` 及对应测试；
3. 第一次 Provider 测试中，Web Streams 合法预取了第 18 个 1 MiB chunk，而消费端在第 17 个 chunk 后判定超限；实现已正确取消，测试由脆弱的精确 pull 次数改为验证 17–18 次内取消；
4. 第二次针对性测试通过。

没有调用真实 Freesound、Seedream、百炼或火山 TTS，也没有读取任何凭据。

## 最终验证

```text
bun install --frozen-lockfile
bun run check
bun run test                 # 221 tests passed
bun run build
bun run bundle:check
bun run doctor
bun run doctor:browser
bun run doctor:desktop
bun run audit                # 0 vulnerabilities
git diff --check
```

全部命令在最终工作树实际通过。Phaser 异步块仍有 Vite 的通用大 chunk 警告，但版本化 raw/gzip 预算无超限。

## 已验证边界

- 哈希读取使用流式文件 API，不把完整资产复制到额外内存；
- 哈希、大小与稳定性检查绑定同一已打开文件句柄；路径与句柄身份在哈希前后均复核，降低检查后替换的竞态窗口；
- preview 的声明长度超过限制时在读取前拒绝；缺失或不可信声明长度时仍由流式硬上限兜底；
- 本实验当时尚未处理崩溃遗留的 `assets.lock`；该历史边界已由后续 [`2026-07-18-asset-lock-recovery`](../2026-07-18-asset-lock-recovery/result.md) 的 owner metadata、同机 PID 与保守 TTL 协议关闭。
