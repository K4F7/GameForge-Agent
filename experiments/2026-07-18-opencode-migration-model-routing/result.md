# OpenCode 迁移与国产模型路由结果

## OpenCode 迁移

迁移前 `opencode auth list` 报 `duplicate column name: commands`。只读检查确认旧数据库 integrity 为 `ok`、外键无违规、`project.commands` 物理上只有一列，但只记录 11 条旧迁移。停止条件满足（无 OpenCode 进程）后，将数据库、touch/WAL/SHM（存在时）和迁移标记备份到 `%USERPROFILE%\.local\share\opencode\backups\pre-1.18.3-<timestamp>\`；未读取或复制 `auth.json`。

OpenCode 1.18.3 随后创建新库：integrity 为 `ok`，迁移数 38，`project.commands` 仍为一列；`opencode auth list` 成功识别 1 个 OAuth credential，不输出 token。旧库保留用于回滚。

直接运行 CodeArts 时发现它会落到 OpenCode 默认数据目录，并因 `workspace` 表已存在失败。改用 CodeArts 专用 `KERNEL_DATA_DIR=%USERPROFILE%\.codeartsdoer\cli-data` 后，`mcp list` 成功；因此项目规则和文档要求始终使用 `bun run codearts` 隔离两套迁移链。

## 本机私有配置

- 已创建仓库忽略的 `.gameforge-validation/integrations/projects`；
- Windows 用户级 `GAMEFORGE_PROJECT_OUTPUT_ROOT` 与 loopback `GAMEFORGE_RUN_RELAY_URL` 已配置；
- Windows 用户级 `CODEARTS_CLI_AK`/`CODEARTS_CLI_SK` 已配置，只验证存在，不记录值；
- 使用 CodeArts 专用数据目录和用户级凭据执行只读 `models` 成功。当前账号返回的精确 ID 为 `huaweicloud-maas/deepseek-v3.2`、`huaweicloud-maas/GLM-4.7-SFT-Harmony`（界面用途为 ArkTS）、`huaweicloud-maas/Glm-5-internal`、`huaweicloud-maas/GLM-5.1`；Kimi K3 不在该列表。

## 模型路由结论

官方资料确认 Kimi K3 于 2026-07-16 发布，模型 ID `kimi-k3`，原生视觉、最长 1M context，适合长时编码、仓库导航和工具编排；API 当前不直接支持视频/PPT/Deep Research，完整权重计划 2026-07-27 开放，官方建议自部署至少 64 个加速器。故 GameForge 将 K3 放在宿主确实支持时的长上下文编排、代码/截图复核，不用于生图、TTS 或音效，也不声称当前 CodeArts 已可用。

借鉴 oh-my-opencode 的部分仅限角色/类别路由：用户覆盖 → primary → fallback → host default；quick 使用较低成本模型，deep/vision 使用对应能力模型，实际路由可诊断。GameForge 不复制其 Agent 循环：CodeArts 仍拥有 orchestration/coding/review/quick/vision，MCP 只拥有 spec/image/tts/sound 单次操作。

新增 `modelRoutingPolicySchema` 和 `config/model-routing.example.json`。可执行 Agent 路由只保留本次 `codearts models` 实际列出的 DeepSeek/GLM；K3 与未确认视觉模型不进入默认 fallback。Schema 校验受支持国产 Provider 与模型家族 ID 的匹配、工具 Provider/能力及 CodeArts/MCP ownership，并要求所有音效 fallback 都保持 Freesound 许可证检索；家族规则不是当前账号模型 allowlist。`officialApiRequired` 只代表采用仓库登记的官方适配器，不能证明账号授权或实时可用性。

CodeArts 普通 CLI 未发现个人用户任意设置 Provider、Base URL 或 BYOK 的公开入口。企业版官方“配置模型”支持管理员接入第三方模型，但只接受 OpenAI `/chat/completions` 接口；模型由管理员接入并真实出现在宿主列表后才可加入路由。MCP 可执行外部模型的单次确定性调用，但不会改变主 Agent 模型。

进一步交叉核验独立榜单后，新增 `docs/model-evaluation-2026-07.md`。Artificial Analysis 2026-07-17 独立结果给 Kimi K3 Intelligence Index 57、全球第 3、AutomationBench-AA 53% 第 1，同时报告事实性任务幻觉率 51%；因此 K3 是跨宿主 long-context/vision 首选候选，但必须由 verifier/测试约束。SWE-bench 官方榜的 GLM-5/Kimi K2.5 成绩属于 Agent+模型组合，且 Verified 已被官方审计指出污染与测试缺陷，GameForge 不据单榜替换当前实际可用模型。Seed1.5-VL/Qwen-VL 数字主要来自厂商模型卡；Seedream/TTS 也没有足够统一的权威持续榜，继续以固定项目任务实测。

oh-my-opencode 官方仓库已改名 oh-my-openagent；npm registry 的 legacy 包 `oh-my-opencode` latest 为 4.19.0（2026-07-17），处于双包/双配置名过渡。其主动模型 fallback、默认关闭的 runtime error fallback、doctor 和能力探测值得借鉴，但未找到 OpenCode 1.18.3 的明确兼容声明，且已有改名期 loader issue；本轮不安装插件，只固化路由原则。

## 官方依据（访问日期 2026-07-18）

- [Kimi K3 官方发布](https://www.kimi.com/blog/kimi-k3)
- [Kimi Agent 与 K3](https://www.kimi.com/help/agent/agent-overview)
- [Kimi Code 模型](https://www.kimi.com/code/docs/en/kimi-code/models.html)
- [Kimi API 模型边界](https://www.kimi.com/help/kimi-api/api-model-selection)
- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
- [智谱 Function Calling](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling)
- [字节 Seed 模型目录](https://seed.bytedance.com/en/models)
- [oh-my-opencode 配置](https://github.com/opensoft/oh-my-opencode/blob/dev/docs/configurations.md)
- [oh-my-openagent Agent/Model Matching](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/agent-model-matching.md)
- [CodeArts CLI 模型命令](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0034.html)
- [CodeArts 企业自定义模型](https://support.huaweicloud.com/usermanual-enterprise/codeartsagent_enterprise_0009.html)

## 定向验证

```text
bun run --filter @gameforge/contracts check
bun run --filter @gameforge/contracts test       # 46 passed
bun run --filter @gameforge/integrations check
bun run --filter @gameforge/integrations test    # 11 passed
```

整仓门禁已通过：`bun run check`、`bun run test`、`bun run build`、`bun run bundle:check`、`git diff --check`。构建仍有已知 Phaser 异步主 chunk 大于 500 kB 警告，但 bundle budget 通过。
