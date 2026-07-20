# 任务

在 Windows 本地环境对游戏媒体 Provider 做一轮真实账号验证：

1. 使用火山方舟 Seedream 4.5 生成一张横版游戏背景；
2. 使用 ElevenLabs 官方 Node SDK 生成一段中文 NPC 对白；
3. 使用豆包语音 `seed-tts-2.0` 双向流式 WebSocket 生成同一句对白；
4. 验证输出格式、字节数、SHA-256、Provider 类型检查、测试与依赖审计；
5. 不把密钥、账号信息、完整请求 ID 或控制台隐私写入仓库。

本轮不执行抖音 preview、上传、提审或发布。
