# 实验结果

日期：2026-07-18

## 实现结果

create 与 replace 事务都在任何临时媒体写入前创建并同步 `assets.transaction.json`。共享日志记录 version、UUID、projectId、连续旧/新 revision、新 entry 与旧/新规范 Manifest SHA-256；replace 额外记录旧 entry。临时文件与备份路径从 entry 和 UUID 推导，不接受日志提供的任意路径。

`ProjectAssetStore.recover` 与 MCP `recover_project_assets` 在资产写锁内执行。恢复重新解析严格 Manifest 并计算规范哈希：精确匹配新状态时验证新媒体并清理 backup/temp/log；create 仍处于旧状态时只删除哈希等于新 entry 的孤儿和临时文件；replace 仍处于旧状态时验证或恢复哈希等于旧 entry 的备份。same-path 替换只有同时存在备份时才把当前目标视为新文件。未知日志版本、额外字段、项目不符、非连续 revision、不同 assetId、第三种 Manifest、符号链接、日志硬链接或哈希冲突都拒绝恢复。

测试使用真实临时文件手工构造进程终止后的磁盘状态，而不是依赖 fs.watch 或权限竞态；覆盖 create old-state orphan rollback、create committed cleanup、replace cross-path rollback、replace committed cleanup、same-path rollback 和未知日志保留。纯 `get_project_assets` 不修改状态，显式恢复返回重新完整验证后的 Manifest。没有调用云 Provider。

## 剩余边界

文件内容执行 `fsync`，但目录项没有可移植的跨平台 fsync 保证。本实验验证正常进程终止后 OS 保留的本地文件状态，不声称突然断电、控制器缓存丢失、网络共享或多主机并发的耐久性。

## 测试结果

```text
bun install --frozen-lockfile   # 198 installs，无变更
bun run check
bun run test                    # 263 tests passed
bun run build
bun run bundle:check
bun run doctor                  # ok: true
bun run doctor:browser          # ok: true
bun run doctor:desktop          # ok: true
bun run audit                   # 0 vulnerabilities
git diff --check
```

以上命令均在最终工作树实际通过。Asset Store 1 个测试文件、18 项测试；MCP Server 5 个文件、36 项测试。Vite 仍报告既有 Phaser 异步 chunk 大于通用 500 kB，但版本化 bundle 预算通过。
