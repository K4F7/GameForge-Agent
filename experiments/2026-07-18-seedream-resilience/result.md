# 实验结果

日期：2026-07-18

## 官方契约核验

访问日期：2026-07-18。

- [火山方舟 ImageGenerations API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)确认 `model` 可使用 Model ID 或推理 Endpoint ID，响应包含实际 `model` 与 `data`；
- [火山方舟图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)确认官方 endpoint、Bearer API Key、`response_format=b64_json`、非流式输出等字段；
- 官方文档没有规定 Seedream 固定超时值，因此项目采用可测试的本地 120 秒生产预算，而不声称这是厂商 SLA。

## 实现结果

- 每次请求使用独立 `AbortSignal.timeout(120000)`；构造器可在测试或专用宿主中设置 1–600000 ms；
- fetch 抛错统一为脱敏的网络错误；信号已触发时稳定报告超时；
- JSON 上限由图片字节上限对应的最大 Base64 字符数再加 1 MiB envelope 得出；
- 声明长度超限时不读取 body，chunked 越界时取消 reader；无效 UTF-8/JSON 返回稳定 bounded JSON 错误；
- 配置直接 Model ID 时拒绝响应 model 不一致；配置 `ep-` Endpoint ID 时接受官方解析后的实际模型，并把实际 model 写入 provenance。

## 测试证据

模拟测试覆盖成功请求 signal、真实计时 abort、网络错误脱敏、声明长度预拒绝、chunked 取消、直接模型不一致和 Endpoint ID 解析。没有发送真实 Seedream 请求，也没有产生费用或读取账号凭据。

首次针对性测试失败是旧 malformed fixture 使用了不同模型名，新一致性校验先于 Base64 检查触发；fixture 改为正确请求模型后继续专门验证缺少图片数据。

最终工作树实际通过：

```text
bun install --frozen-lockfile
bun run check
bun run test                 # 230 tests passed
bun run build
bun run bundle:check
bun run doctor
bun run doctor:browser
bun run doctor:desktop
bun run audit                # 0 vulnerabilities
git diff --check
```

Phaser 异步块仍触发 Vite 的通用大 chunk 提示，但版本化 bundle 预算全部通过。

## 剩余边界

- 120 秒是项目预算，不是火山官方承诺；真实账号的排队、限流、Request ID、费用和画质仍需 `provider:smoke --execute`；
- 当前 provenance 只有实际模型字段，没有单独保存 Endpoint ID；若审计需要同时追踪接入点，应先扩展共享 AssetProvenance Schema；
- Base64 图片结果仍需要在内存中解码后交给 Asset Store，这是现有 Provider 返回契约的边界。
