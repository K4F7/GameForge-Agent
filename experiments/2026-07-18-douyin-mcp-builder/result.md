# 实验结果

状态：通过。

新增 `DouyinMiniGameBuilder`：验证绝对 projects root/CLI、真实且不含符号链接的 `.gameforge`、托管 Manifest projectId 与 `douyin-mini-game` target；固定 LayaAir 3.4.0；固定 build/bytedancegame/project/out 参数；子进程不使用 shell 用户输入，只传递系统、PATH和临时目录变量；日志各最多保留64 KiB且不返回；120秒超时并终止进程树；`.gameforge/laya-build.lock` 拒绝并发；构建后重新验证产物根文件、符号链接、分包和4/20 MiB。

MCP 条件注册 `build_douyin_mini_game({projectId})`，capability snapshot 新增 `engineering.douyinBuild`，doctor 会核验 ready 与工具表一致。用户级 `GAMEFORGE_LAYAIR_CLI` 已配置为官方 dispatcher 路径，仅记录变量名，不记录用户环境值。

真实 doctor：`ok: true`，工具表包含 `build_douyin_mini_game`，`generator/douyinBuild/verifier/preview/assetStore` 为 true。随后真实 Node stdio MCP Client 调用该工具，结果：

```json
{
  "projectId": "douyin-generated-091",
  "cliVersion": "3.4.0",
  "validation": {
    "passed": true,
    "fileCount": 12,
    "totalBytes": 1097619,
    "mainPackageBytes": 1097619,
    "subpackages": [],
    "deviceOrientation": "portrait"
  },
  "stdoutTruncated": false,
  "stderrTruncated": false
}
```

安全复核后补充了 `.gameforge` 目录逃逸回归，validator 共8项测试；旧 capability 快照缺少 `douyinBuild` 时兼容为 `false`。MCP测试覆盖条件注册和调用；doctor测试覆盖 capability→tool 映射。收紧环境后再次执行真实官方 LayaAir CLI，产物指标保持不变。该工具仍不证明抖音 DevTool/真机运行。
