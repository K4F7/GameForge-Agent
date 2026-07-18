# 实验结果

状态：源工程生成、官方构建与静态校验通过。

生成器 0.9.0 为 `douyin-mini-game` 生成 11 个托管文件，包括 Laya 3.4.0 项目标识、固定启动场景/meta、settings、TypeScript 运行时和两份同哈希 GameSpec。dry-run 两次完全一致；apply 原子创建。运行时从 `assets/resources/game-spec.json` 读取数据，不把用户标题或目标插入 TypeScript。

全新项目 `douyin-generated-090` 使用包含 4 个收集物、2 个危险物、3 条生命和 240 移速的中文 GameSpec。官方 `layaair build bytedancegame` 返回成功，bundle 中确认保留 GameSpec JSON 加载及 gameplay 字段消费。GameForge validator：

```json
{
  "passed": true,
  "fileCount": 12,
  "totalBytes": 1097629,
  "mainPackageBytes": 1097629,
  "subpackages": [],
  "deviceOrientation": "portrait"
}
```

独立复核发现危险物可能在极端位置连续逐帧扣命，模板随后增加 1 秒受击保护；重新生成全新项目并再次通过官方 Laya build 与静态校验（12 文件、1,097,619 bytes）。单元测试还证明非 arcade 抖音规格被拒绝，托管项目不能在 update 时从 web 切换到抖音或反向切换。尚未进行抖音 DevTool/真机验收，也未把 Laya build 封装成 MCP 工具。
