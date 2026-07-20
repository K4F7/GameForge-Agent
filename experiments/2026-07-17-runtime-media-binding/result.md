# 运行时媒体绑定结果

## 实现

- 生成器升级为 0.4.0；
- 生成运行时对 Manifest 条目执行角色、MIME、`assets/` 相对路径、角色唯一性校验，不可信条目不进入 Phaser Loader；
- `voice` 与 `bgm` 均等待第一次点击或按键，BGM 以 0.35 音量循环播放；
- 媒体加载、解码或自动播放失败继续采用程序化纹理与静音回退；
- Freesound 官方预览适配器默认返回 `kind: "sound"`，仅当确定性工具收到 `role: "bgm"` 时返回 `kind: "music"`，没有放宽 Asset Store 的角色—来源一致性检查；
- CodeArts `gameforge-build` Skill 和运行时文档已同步角色选择规则。

## 工具调用与耗时

- 模型调用：0；
- 云 Provider 调用：0；
- `generate.ts`：生成项目、生成 1644 字节本地 WAV、经生产 Asset Store 写入 BGM，约 1.1 秒；
- 生成工程 `bun install` + `bun run check` + `bun run build`：约 13.9 秒；
- 第一次系统 Chrome 验收：2933 ms，但人工复核发现截图只有背景色，由此定位到旧就绪条件过早；
- 收紧就绪条件后的系统 Chrome 验收：4395 ms，动作 1 次；
- 人工干预：0。

## 独立生成工程证据

生成工程固定依赖 Phaser 4.2.1、Vite 8.1.4、TypeScript 7.0.2；自身类型检查和生产构建通过。Manifest revision 为 1，BGM 条目为：

```text
assetId: music/test-loop
kind: music
role: bgm
mimeType: audio/wav
bytes: 1644
sha256: fb376da4e8dd8d7cc26a3122f214b60e5ff7259713d18c329871c3b3ce82cba1
```

初次报告虽为 `passed: true`，但状态没有 telemetry，截图只有 `#08111f` 背景，证明原先“Canvas 节点 + 初始状态”不足以表示 Phaser 已完成首帧。验收器现等待 telemetry，并把 Canvas 缩小到 48×27 后要求出现至少两组有明显差异的像素。

修复后系统 Chrome 按一次 Space 触发音频解锁，返回 `passed: true`、`status: running`、Canvas 960×540，并包含玩家、5 个收集物和 3 个危险物的完整 telemetry；console errors、page errors、failed requests 均为 0。人工复核新截图确认标题、目标、HUD、程序化实体和中文操作提示均可见。截图证据保存在被忽略验证目录的项目内 `.gameforge/verification/`。

## 整仓验证

- `bun run check`：通过；
- `bun run test`：167 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 仍有已知 500 kB 警告；
- `bun install --frozen-lockfile`：检查 171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `bun run doctor`：真实 Node stdio MCP 握手通过，`ok: true`；
- `git diff --check`：通过。

## 边界

- 本实验使用确定性本地 WAV，不声称调用或验证了真实 Freesound 账号；
- Freesound preview 适合快速试听与原型绑定，商用原始文件获取和授权仍须遵循其官方 API/OAuth 与许可条款；
- 当前没有把实验性的国产音乐生成模型设为默认，背景音乐仍采用许可证过滤后的快速检索路径；
- 浏览器可证明 BGM 文件成功请求、解码后无诊断且游戏未受阻，但无头验收不评价音乐审美质量。
