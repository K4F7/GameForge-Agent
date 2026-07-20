# Provider 账号级 Smoke

## 输入任务

使用真实百炼 Qwen 生成一个中文单屏收集游戏规格，并以最小请求验证 Seedream 图片、Freesound CC0 preview、火山异步 TTS 的官方适配器与 Asset Store 落盘链路。

## 安全与费用边界

- 默认命令只检查环境变量名称，不打印值、不发网络请求。
- 真实调用必须显式传入 `--execute`，会产生模型请求、配额消耗或费用。
- 使用短提示、1K 单图、单条 Freesound 结果和短 TTS 文本。
- TTS 查询有界；任务仍 processing 时不伪造成功。
- 运行证据写入仓库忽略目录，提交的结果文档不得包含密钥、完整 jobHandle 或临时音频 URL。

## 命令

```powershell
bun run provider:smoke
bun run provider:smoke -- --execute --providers=qwen,seedream,freesound,tts
```
