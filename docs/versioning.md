# GameForge 版本规范

状态：accepted
日期：2026-07-21
当前版本：`0.1.0-alpha.1`

## 格式

GameForge 使用标准三位 Semantic Versioning：

```text
MAJOR.MINOR.PATCH
```

- `MAJOR`：不兼容的产品或核心契约变更；
- `MINOR`：向后兼容的新功能；
- `PATCH`：Hotfix、Bug、安全或兼容性修复。

不使用四位版本号。构建编号使用不参与版本优先级的元数据：

```text
0.1.0-alpha.1+build.4
0.1.0-rc.1+sha.a1b2c3d
```

## 发布阶段

```text
0.1.0-alpha.1
0.1.0-beta.1
0.1.0-rc.1
0.1.0
0.1.1
```

- `alpha`：闭环尚未完成，允许较大调整；
- `beta`：核心闭环已经验证，继续完善和回归；
- `rc`：功能冻结，只修复发布阻塞问题；
- 无后缀：正式版本；
- PATCH 递增：正式版后的 Hotfix。

不同时引入 `preview`、`eap`、`canary` 等近义人工发布渠道。自动构建可以使用 `+build.N`，但它不是新的发布阶段。

## 晋级门槛

### Alpha 到 Beta

至少一个 `arcade` 黄金任务完成真实 OpenChamber、CodeArts、MCP、Phaser、Chrome 和 GUI 证据闭环，并完成一次同 Project 修改任务。

### Beta 到 RC

五种 Web 模板回归、新建与修改流程通过；`bun run check`、`bun run test`、`bun run build` 和 `bun run workbench:smoke` 全部通过；没有阻塞缺陷。

### RC 到 Stable

功能冻结，发布说明、升级/回滚说明和最终复验完成。RC 期间不得加入新的产品功能。

### Stable 到 Patch

只修复 Bug、安全问题和兼容性回归。任何新功能必须进入下一 MINOR。
