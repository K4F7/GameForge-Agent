# 任务

为 GameForge 增加 `wechat-mini-game` 第二导出 target，复用统一 GameSpec、五种玩法和 Asset Store，并通过官方 LayaAir CLI 3.4.0 的 `wxgame` 构建与独立静态校验。

验收条件：

- 生成请求、计划和托管 Manifest 显式记录微信 target；
- 五种 genre 逐一真实构建；
- 校验根文件、4 MiB 主包/20 MiB 总包、远程脚本、HTTPS 域名、`wx.*` capability 与资产哈希；
- MCP、Workbench、TUI 和 CodeArts Skill 能区分抖音/微信；
- 不登录、预览、上传或发布，不把 CLI 结果冒充 DevTool/真机证据。
