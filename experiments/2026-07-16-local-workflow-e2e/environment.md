# 环境与执行记录

- 日期：2026-07-16
- 时区：Asia/Shanghai
- 执行窗口：约 21:17–21:19
- 包管理与命令执行：Bun 1.3.14
- 测试框架：Vitest 4.1.10
- 游戏模板：Phaser 4.2.1 + Vite 8.1.4 + TypeScript
- 模型：未调用
- 云 Provider：未调用
- 密钥：未使用
- 测试文件：`packages/mcp-server/src/workflow.integration.test.ts`

## 工具调用计数

- MCP：23 次
  - `claim_game_task`：1
  - `get_gameforge_capabilities`：1
  - `replay_game_run`：2
  - `validate_game_spec`：1
  - `publish_run_events`：8
  - `generate_game_project`：2
  - `request_image_asset`：1
  - `import_sound_asset`：1
  - `submit_voice_job`：1
  - `query_voice_job`：1
  - `materialize_voice_job`：1
  - `start_game_preview`：1
  - `verify_game_project`：1
  - `complete_game_run`：1
- 直接 HTTP：2 次（创建 Task、获取预览 HTML）
- 外部网络：0 次
- 图片 Provider：内存中的确定性测试替身，返回带正确 SHA-256 的 JPEG 魔数字节；未调用 Seedream
- 音效 Provider：内存中的确定性 Freesound 预览替身，保留 CC0 来源和署名字段；未访问 Freesound 网络
- TTS Provider：内存中的确定性异步任务替身，submit 返回 processing、单次 query 返回 succeeded、materialize 返回 WAV；未调用火山语音

## 人工干预

首次运行时，预览已返回 HTTP 200 和真实模板 HTML，但测试错误断言旧容器 ID `game-root`。人工检查输出后将断言改为当前固定入口 `id="game"` 与 `/src/main.ts`，没有修改产品行为。
