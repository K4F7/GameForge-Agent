# 实验结果

状态：本地适配器与确定性 MCP 闭环已实现；真实账号验收待配置。

已验证：

- 只接受 `api.minimaxi.com` / `api.minimax.io` 官方 HTTPS music endpoint；
- Bearer key 仅来自服务端环境，不进入 MCP 参数或证据；
- Prompt 1–2000 字符，固定纯音乐、非流式 hex MP3；
- 声明长度和 chunked JSON 均受限，解码前限制 16 MiB 音频；该上限覆盖官方约 5 分钟、256kbps 输出，并降低 hex JSON 解析内存峰值；
- 校验 Provider 终态、hex、MP3 魔数并记录 model、prompt、license、SHA-256；
- 生成 POST 硬性单次发送，不暴露 retry 配置，不对模糊失败自动重试；
- stale replacement 在调用付费 Provider 前按 Manifest revision 拒绝；
- `generate_music_asset` 成功时以唯一 `bgm` 角色写入运行时 Manifest；
- capability、Workbench Provider 状态、doctor 工具映射与 provider smoke 选择同步扩展。

边界：官方 API 页面没有直接授予通用商用权。只有账号持有人确认实际套餐与用途并设置 `GAMEFORGE_MUSIC_LICENSE` 后工具才注册；本实验没有真实调用，不能评价音乐质量、循环点、生成耗时、价格或输出权利。
