# 实验结果

日期：2026-07-18

## 官方依据

- [百炼限流应对最佳实践](https://help.aliyun.com/zh/model-studio/rate-limiting-best-practices)：官方示例对 429、5xx 与连接错误使用指数退避；未规定 `Retry-After` 或幂等键。
- [火山方舟图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)：429 表示额度/并发限制；未找到生成请求幂等键或通用重试承诺。
- [豆包异步长文本语音合成](https://www.volcengine.com/docs/6561/1096680?lang=en)：`reqid` 每次请求必须唯一；因此 submit 网络结果不确定时不自动重放。
- [Freesound API Overview](https://freesound.org/docs/api/overview.html)：429 表示超出速率，5xx 表示服务端错误；未规定 `Retry-After`。

访问日期均为 2026-07-18。`Retry-After` 支持属于通用 HTTP 客户端兼容能力，不宣称四个 Provider 一定返回该 Header。

## 实现结果

新增 `ProviderRequestError` 与共享 `fetchProvider`：认证、授权、限流、配额、超时、网络、服务端和请求错误均有稳定字段；只重试 408、429、5xx、超时与网络故障。默认最多三次，指数退避带抖动并受 5 秒默认上限约束，任何配置不允许超过 6 次或 60 秒。错误响应在抛出或重试前取消 body，错误消息不读取响应正文。

百炼按官方建议默认有限重试。Freesound 搜索、preview、TTS query/materialize 都是只读路径，可有限重试。Seedream 生图与 TTS submit 可能产生计费或重复任务，默认只尝试一次；Seedream 只有在调用方显式配置后才会重试，TTS submit 始终单次。

Freesound 搜索 JSON 新增 4 MiB 流式上限；所有声明长度超限路径会取消 response body。当前实验只使用 mock HTTP，不代表真实账号额度、延迟、模型效果或 CDN 已验收。

## 测试结果

```text
bun install --frozen-lockfile   # 198 installs，无变更
bun run check
bun run test                    # 251 tests passed；Provider 41
bun run build
bun run bundle:check
bun run doctor                  # ok: true
bun run doctor:browser          # ok: true
bun run doctor:desktop          # ok: true
bun run audit                   # 0 vulnerabilities
git diff --check
```

以上命令均在最终工作树实际通过。Vite 仍报告既有 Phaser 异步 chunk 大于通用 500 kB，但版本化 bundle 预算通过。Provider 专项 6 个测试文件、41 项测试覆盖共享退避、`Retry-After` 秒值、错误分类、调用方取消、凭据脱敏、终态 body 取消、Freesound 搜索 JSON 上限、五条适配路径和两类非幂等默认策略。
