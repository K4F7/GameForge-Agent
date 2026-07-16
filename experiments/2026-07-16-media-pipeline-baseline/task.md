# 实验任务

## 原始目标

完善 GameForge 游戏 Agent：默认采用国产模型路由，接入字节跳动 Seedream 生图、豆包语音 TTS、音效搜索/导入；优先使用官方接口实践，并参考开源游戏生成 Agent 和前端实现。

## 本次实验范围

1. 验证固定 Phaser 项目生成器可生成独立、可构建的游戏工程。
2. 验证 Seedream、Freesound 和火山异步长文本 TTS 适配器的请求契约、安全边界和错误脱敏。
3. 验证生成素材可安全进入 `public/assets/manifest.json`，并由游戏运行时加载。
4. 验证 Run Relay、MCP 工具和 React 工作台能够通过严格事件契约衔接。
5. 记录未使用真实云账号和未完成浏览器视觉验收的边界。

## 验收条件

- 整仓 TypeScript 严格检查、测试与生产构建通过。
- 独立生成项目通过 TypeScript 检查和 Vite 生产构建。
- TTS 工具为提交、单次查询、素材化三步，不在 MCP 内轮询。
- 外部素材记录 provider、model/source、prompt、license、attribution（适用时）与 SHA-256。
- API 凭据不进入 MCP 参数、错误消息、资产清单或仓库。
- 真实云端效果未验证时必须明确标记，不得以模拟测试代替。
