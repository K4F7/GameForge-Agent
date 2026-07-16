# 环境

- 日期：2026-07-16
- 时区：Asia/Shanghai
- Bun：1.3.14
- MCP SDK：1.29.0
- Run Relay：真实 HTTP server
- MCP Client：2 个相互独立的内存传输会话，模拟 CodeArts 客户端重启
- Task：1 个
- 已发布事件：`run.started`、`phase.completed(spec)`、`voice.job.updated(processing)`
- 模型调用：0
- 媒体调用：0
- 人工干预：0

Client A 使用确定性 TTS 替身提交任务并发布带签名句柄的 processing 事件；Client B 从 Run 回放恢复该句柄，并用它执行一次 `query_voice_job`，得到 succeeded。测试没有轮询，也没有调用真实媒体服务。

## 云配置探测

仅判断变量是否存在，没有输出值。当前以下配置均不存在：百炼 API key、方舟 API key/模型/许可、Freesound key/用途、火山语音 token/app ID/许可/音频主机。因此本实验没有执行或声称任何真实云调用。
