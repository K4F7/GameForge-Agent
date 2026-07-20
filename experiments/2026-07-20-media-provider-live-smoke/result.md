# 实验结果

## 结论

三条真实媒体调用均已到达对应官方服务。Seedream 4.5 图片生成成功；ElevenLabs 中文语音生成成功但人工试听认为 AI 感较强；豆包语音 `seed-tts-2.0` 使用官方二进制事件协议生成同一句中文对白成功，作为后续中文游戏语音首选候选。

## Seedream 4.5

- 模型：`doubao-seedream-4-5-251128`
- 输出：JPEG，2560×1440
- 字节数：1,064,760
- SHA-256：`137be4eacc8cba6fc7b3cc5a64b42ce588e221e4561b378ac0865799b62ea245`
- 本地输出：`.gameforge-validation/seedream-live/game-background-4.5.jpg`
- 人工视觉检查：东方幻想森林遗迹构图完整，中央留有玩法区域；生成结果仍包含少量类似角色/收集物的小型元素，作为纯背景使用前应进一步约束提示词或后处理。

首次请求使用 1920×1080 时，官方返回尺寸像素数不足；改为 2560×1440 后成功。错误已脱敏，未保存账号与请求 ID。

## ElevenLabs

- SDK：`@elevenlabs/elevenlabs-js` 2.58.0
- 模型：`eleven_multilingual_v2`
- 音色：预置音色
- 输出：MP3
- 字节数：93,248
- SHA-256：`1448f45e2c78f93d9a6ca67922001e018e91d420d90790ae3ff8373fabd32bc9`
- 本地输出：`.gameforge-validation/elevenlabs-live/npc-welcome.mp3`
- 人工试听：中文可懂，但机械感和通用 AI 配音感较明显，因此不作为中文默认。

## 豆包语音

- 协议：`wss://openspeech.bytedance.com/api/v3/tts/bidirection`
- 资源：`seed-tts-2.0`
- 音色：`zh_female_gaolengyujie_uranus_bigtts`
- 输出：MP3，24 kHz
- 时长：6.048 秒
- 字节数：48,429
- 计费文本数：26
- SHA-256：`b20dfc9c7191cad486cc8644d59616df9654c6951bdd479a9a5cc8cf6f0fe0ea`
- 本地输出：`.gameforge-validation/volcengine-tts-live/npc-welcome.mp3`

仓库新增严格 TypeScript 协议实现，依据官方附件定义 4 字节基础帧头、事件、会话 ID、Payload 长度和音频响应解析。该实现与既有异步长文本 Provider 并存，不替换其作业语义。

## 验证命令

```text
bun run --filter @gameforge/providers test
bun run --filter @gameforge/providers check
bun audit --production
```

结果：8 个测试文件、51 项测试通过；严格类型检查通过；生产依赖审计为 0 个已知漏洞。

## 边界

- 媒体文件保存在 `.gameforge-validation/`，尚未写入具体游戏项目的 Asset Store；
- 双向 TTS 当前为 Provider 层实现，尚未注册新的同步语音 MCP 工具；
- 中文最终音色仍需人工试听并从控制台音色库选择；
- 所有已在交互中暴露的 Key 应在实验完成后轮换。
