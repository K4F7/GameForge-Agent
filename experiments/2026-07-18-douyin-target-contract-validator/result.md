# 实验结果

状态：契约与静态门禁完成；平台运行时仍待实现。

- 生成请求新增 `target: web | douyin-mini-game`，旧请求默认 `web`；
- 计划和 `.gameforge/manifest.json` 记录 target，plan SHA-256 纳入 target；
- 生成器升级为 0.8.0；当前收到 `douyin-mini-game` 会明确失败，避免生成伪平台项目；
- 新增 `@gameforge/minigame-validator` 和 `bun run minigame:validate -- <absolute-root>`；
- 校验根文件、配置、方向、网络超时边界、符号链接、分包根、主包 4 MiB 与目录 20 MiB；
- 单元测试覆盖合法分包、缺文件、DOM 入口、非法方向、符号链接、超限主包和不安全/重复分包根。

本实验没有抖音开发者工具或真机证据，因此不能声称 `douyin-mini-game` target 已可生成或发布。
