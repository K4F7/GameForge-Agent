# 实验结果

日期：2026-07-18

## 实现结果

项目生成请求新增向后兼容的 `operation: "create" | "update"`，默认 create；`mode` 仍为 dry-run/apply。update dry-run 读取严格受管 Manifest，逐个打开并哈希旧托管文件，输出当前 plan SHA-256 与五类排序路径。Asset Store 管理的 runtime manifest 永久 preserve；Manifest 未列出的用户文件和 `bun.lock` 不进入删除集合。

update apply 必须传入 dry-run 的 `currentPlanSha256`。取得 0600 owner lock 后再次读取 Manifest、执行 CAS 并重新哈希；每个文件写入同目录临时文件，旧文件先备份，新文件通过 hardlink no-replace 发布，受管 Manifest 最后切换。普通异常按反向顺序恢复所有已登记备份；rename 后会立即登记 backup，link/unlink 失败不会遗漏恢复。写入前再次核对旧哈希，缩小检查后被外部修改的窗口。不存在 force 参数。

owner lock 记录 version、UUID token、PID、hostname 和时间；只有同机、至少 10 分钟且 PID 明确不存在时才保守回收。PID 权限或状态未知视为仍存活。成功更新后摘要保留 pre-apply `currentPlanSha256`，因为它是本次 apply 的 CAS 输入，而不是结果计划哈希；结果计划哈希位于顶层 `plan.planSha256`。

## 已知边界

此处记录的强制进程终止缺口已由同轮后续持久 `update.transaction.json` 与 `recover_game_project_update` 关闭。网络文件系统、多主机写入、目录项跨平台 fsync 与突然断电仍不在保证内。

## 持久恢复增量

日志在任何模板临时文件之前同步写入，严格记录 add/update/delete 的旧/新 metadata、旧/新 Manifest SHA-256 与 plan SHA-256。恢复测试先完成一次真实 update 取得两份权威 Manifest，再手工构造“文件已切换但 Manifest 仍旧”和“Manifest 已新但 backup 未清理”两种进程中断磁盘状态；前者回滚到旧 GameSpec，后者保留新 GameSpec 并清理 backup。MCP 单元测试确认恢复工具只调用注入的 generator recovery，不接触模型或 Provider。

## 测试结果

```text
bun install --frozen-lockfile   # 198 installs，无变更
bun run check
bun run test                    # 270 tests passed
bun run build
bun run bundle:check
bun run doctor                  # ok: true
bun run doctor:browser          # ok: true
bun run doctor:desktop          # ok: true
bun run audit                   # 0 vulnerabilities
git diff --check
```

以上命令均在最终工作树实际通过。Contracts 8 个测试文件、40 项测试；Generator 1 个文件、15 项测试；MCP Server 5 个文件、37 项测试。新增覆盖干净项目更新、运行时资产与未知文件保留、用户修改冲突、stale plan CAS、同机死亡 PID stale lock、update old/new Manifest 恢复以及 delete 恢复不触碰未知文件。Vite 仍报告既有 Phaser 异步 chunk 大于通用 500 kB，但版本化 bundle 预算通过。
