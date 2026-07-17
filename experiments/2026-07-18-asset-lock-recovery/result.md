# 实验结果

日期：2026-07-18

## 官方语义与决策

访问日期：2026-07-18。

- [Node.js fs](https://nodejs.org/api/fs.html)说明 `open` 的 `wx`/`O_EXCL` 在路径已存在时失败，并提示部分网络文件系统不保证该语义；
- [Node.js process.kill](https://nodejs.org/api/process.html#processkillpid-signal)说明 signal 0 可测试进程存在性，PID 不存在时抛错；Windows 支持存在性检查但不是 POSIX signal；
- [Node.js os.hostname](https://nodejs.org/api/os.html#oshostname)只返回当前 OS hostname，不具备全局唯一性。

因此实现只面向本机本地文件系统：PID 存活或检查权限/错误不明确时视为活跃；PID reuse 只会造成保守不恢复，不会误删。hostname 不同一律拒绝。没有引入第三方锁依赖，也没有新增 MCP unlock 工具。

## 实现结果

主锁与 recovery guard 都写入严格 JSON metadata：version 1、UUID token、当前 PID、hostname、createdAtMs；创建后 `sync()`。主锁 `EEXIST` 后先原子取得 recovery guard，再两次读取并比对 token；仅合法同机 metadata、年龄至少 600000 ms、PID 明确不存在时 unlink 并重新 `open("wx")`。另一个正常写者若先取得新锁，恢复者不会删除它。

释放时先比较打开句柄与路径的 device/inode，再核对路径 metadata token；只有仍属于本 owner 才在句柄保持打开时删除路径，随后关闭句柄，避免校验与删除之间出现可替换窗口。metadata 初始化失败也会关闭句柄并清理刚创建的路径。Manifest 读取同样绑定打开句柄、路径 device/inode 与 realpath，拒绝符号链接和项目目录逃逸。

## 测试证据

- 旧、同机、死亡 PID 的主锁可恢复并完成 Manifest revision 1；
- 活 PID、近期死亡锁、异地主机锁均拒绝且原文件保留；
- 零字节旧格式锁拒绝且不修改；
- stale recovery guard 与 stale 主锁可共同恢复；
- Asset Store 1 个测试文件、9 项测试通过。

## 最终门禁

```text
bun install --frozen-lockfile   # 198 installs，无变更
bun run check
bun run test                    # 239 tests passed；TUI 16，Asset Store 9
bun run build
bun run bundle:check
bun run doctor                  # ok: true
bun run doctor:browser          # ok: true
bun run doctor:desktop          # ok: true
bun run audit                   # 0 vulnerabilities
git diff --check
```

以上命令均在最终工作树实际通过。Vite 仍报告既有 Phaser 异步 chunk 大于通用 500 kB 提示，但版本化 bundle 预算通过。

## 剩余边界

- Node 没有跨平台 compare-and-unlink 原语；recovery guard 将合作进程的删除窗口串行化，但恶意外部进程仍可直接替换文件；
- `process.kill(pid, 0)` 不能证明 PID 对应原进程，PID reuse 时会保守拒绝；
- 网络共享、容器跨 hostname、系统时钟回拨和多主机写入不受支持；
- 临时 asset/manifest 文件的垃圾回收仍独立于锁恢复，提交时的 Manifest/asset 一致性规则不变。
