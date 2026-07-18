# 实验环境

- 日期：2026-07-18
- Bun：1.3.14
- Node 类型基线：22.20.1
- 转译器：esbuild 0.25.12，仅测试依赖
- 被测源码：`packages/generator/src/douyin-template.ts` 导出的同一 `Main.ts` 模板
- 宿主：Node `vm` + 最小 Laya stage/timer/display stub
- 模型：未调用
- 云 Provider、网络、文件输出、抖音账号、AppID、DevTool：未使用
