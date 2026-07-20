# 实验任务

日期：2026-07-18

## 输入任务

按火山方舟官方图片生成 API 加固默认国产生图 Provider：为 Seedream 请求增加确定性超时、成功 JSON 流式字节上限和模型一致性检查，避免挂起、超大响应或错误模型污染 CodeArts 资产 provenance。

## 验收条件

1. 保持官方 `POST /api/v3/images/generations`、Bearer API Key 与现有请求字段；
2. Provider 自身设置超时，不依赖 MCP 调用者取消；
3. 网络与超时错误稳定且不回显 API Key；
4. `Content-Length` 和 chunked 实际响应均受硬上限约束，超限 reader 被取消；
5. 直接 Model ID 响应必须一致，`ep-` Endpoint ID 允许解析为实际模型；
6. 不调用真实付费 API，模拟测试与整仓门禁通过。

## 模型与人工干预

- 实现模型：GPT-5 Codex；
- 云 Provider：未调用；
- 子代理：分别核对本地实现与火山官方文档；
- 人工干预：无。
