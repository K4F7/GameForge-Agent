# 实验结果

## 结论

抖音开发者工具 4.5.4 已成功导入受管 `release/bytedancegame` 工程。本地“普通编译”完成，状态栏显示 `[Simulator]Compile End`，问题计数为 0；内置模拟器成功渲染玩家、收集物、障碍、HUD 和倒计时。

首次模拟器运行暴露了一个此前 headless 验收未覆盖的平台差异：DevTool 运行时加载的 `targetDurationSeconds` 可能为非有限值，HUD 曾显示 `undefined`/`NaN`。生成模板现将该字段显式转换为数值，并在非有限或非正值时回退到 60 秒。修复版本在同一 DevTool 工作区重新编译后，HUD 显示有效秒数并持续倒计时。

因此，路线图中的“抖音小游戏开发者工具本地导入、编译器与模拟器检查”已经完成。该结论不包含平台 preview、真机扫码、上传、提审或发布。

## 证据

- 工程窗口标题表明 `bytedancegame` 已进入抖音开发者工具工作区；
- 资源管理器列出 `game.js`、`game.json`、`project.config.json`、`Scene.ls`、`js/`、`libs/` 与 `resources/`；
- 本地普通编译状态为 `[Simulator]Compile End`；
- 编辑器问题计数：错误 0、警告 0；
- 模拟器渲染场景、玩家、三个收集物、障碍与生命值；
- 修复后 HUD 倒计时为有限正整数，并随时间递减；
- DevTool 控制台没有显示游戏运行时错误。

出于隐私与安全考虑，本轮不保存含账号头像、测试 AppID 或本机路径的原始截图。证据来自实时窗口可访问性树和人工可见的模拟器画面。

## 代码修复

- `packages/generator/src/douyin-template.ts`：归一化平台运行时加载的持续时间，并增加 60 秒安全回退；
- `packages/generator/src/generator.test.ts`：锁定生成源码必须包含持续时间归一化门禁。

## 验证命令

```text
bun test packages/generator/src/generator.test.ts packages/generator/src/douyin-headless.test.ts
bun run --filter @gameforge/generator check
```

结果：25 项测试通过，0 失败；Generator 严格类型检查通过。

## 边界

- 本轮没有点击 DevTool 的“预览”“真机调试”“上传”或其他远程操作；
- 真机二维码仍依赖远程 preview，继续按项目策略暂缓；
- 60 秒回退只处理平台加载异常；正常运行时仍优先使用通过 GameSpec 校验的目标持续时间。
