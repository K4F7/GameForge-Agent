# 实验结果

日期：2026-07-18

## 实现结果

项目生成请求新增向后兼容的 `operation: "create" | "update"`，默认 create；`mode` 仍为 dry-run/apply。update dry-run 读取严格受管 Manifest，逐个打开并哈希旧托管文件，输出当前 plan SHA-256 与五类排序路径。Asset Store 管理的 runtime manifest 永久 preserve；Manifest 未列出的用户文件和 `bun.lock` 不进入删除集合。

update apply 必须传入 dry-run 的 `currentPlanSha256`。取得 0600 owner lock 后再次读取 Manifest、执行 CAS 并重新哈希；每个文件写入同目录临时文件，旧文件先备份，新文件通过 hardlink no-replace 发布，受管 Manifest 最后切换。普通异常按反向顺序恢复所有已登记备份；rename 后会立即登记 backup，link/unlink 失败不会遗漏恢复。写入前再次核对旧哈希，缩小检查后被外部修改的窗口。不存在 force 参数。

owner lock 记录 version、UUID token、PID、hostname 和时间；只有同机、至少 10 分钟且 PID 明确不存在时才保守回收。PID 权限或状态未知视为仍存活。成功更新后摘要保留 pre-apply `currentPlanSha256`，因为它是本次 apply 的 CAS 输入，而不是结果计划哈希；结果计划哈希位于顶层 `plan.planSha256`。

## 已知边界

普通 Promise/文件系统错误有内存回滚记录，但项目更新尚无像 Asset Store 那样的持久事务日志。进程在单个文件 backup 与新文件发布之间被强制终止时，下一次 stale-lock 恢复会保守检测到托管文件缺失/哈希冲突并停止，不会继续覆盖，但需要人工恢复 `.bak`。网络文件系统、多主机写入和突然断电也不在保证内。

## 测试结果

```text
bun install --frozen-lockfile   # 198 installs，无变更
bun run check
bun run test                    # 267 tests passed
bun run build
bun run bundle:check
bun run doctor                  # ok: true
bun run doctor:browser          # ok: true
bun run doctor:desktop          # ok: true
bun run audit                   # 0 vulnerabilities
git diff --check
```

以上命令均在最终工作树实际通过。Contracts 8 个测试文件、40 项测试；Generator 1 个文件、13 项测试。新增覆盖干净项目更新、运行时资产与未知文件保留、用户修改冲突、stale plan CAS、同机死亡 PID stale lock 恢复。Vite 仍报告既有 Phaser 异步 chunk 大于通用 500 kB，但版本化 bundle 预算通过。
