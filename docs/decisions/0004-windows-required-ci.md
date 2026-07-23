# ADR-0004：Windows 作为必需 CI 平台

状态：接受
日期：2026-07-23

## 背景

UI Test Harness 使用真实 Windows ConPTY 启动 CodeArts，并以 Playwright 驱动浏览器。PR #17 的真实 CI 证明 Windows 验证成功，但 Ubuntu 与 macOS 因未提供 Playwright Chromium 可执行文件而失败，使 `PR Gate` 不能反映当前支持边界内的验证结果。

## 决策

非纯文档 PR 只在 `windows-latest` 执行完整 Bun 验证。`PR Gate` 只要求这一 Windows job 成功；Ubuntu 与 macOS 不再作为必需 matrix 平台。

## 替代方案

- 保留三平台 matrix 并在每个平台安装 Playwright 浏览器：暂不采用。它会扩大下载、缓存和运行时维护面，且 ConPTY 驱动仍然是 Windows 专属。
- 跳过浏览器测试以维持三平台：不采用。会让 UI 集成的关键公共行为失去 CI 证据。

## 后果

- PR Gate 对当前产品支持边界给出确定性结果。
- Linux/macOS 兼容性不再由必需 CI 声明；未来若承诺支持，必须先新增对应运行时与验收证据，再扩展 matrix。
- Browser、ConPTY、Relay 和 Evidence 的现有 Windows 集成测试继续作为完整门禁的一部分。

## 验收

1. 非文档 PR 的 CI 只创建 `bun (windows-latest)` job。
2. 该 job 通过后 `PR Gate` 成功；未通过时 Gate 的日志明确报告 Windows Bun CI 失败。
3. PR #17 的新 head SHA 在 Windows job 与 `PR Gate` 上均为成功，且不因缺少 Linux/macOS Playwright 浏览器而失败。
4. 手写的 `.github/workflows/ci.yml` 通过 `actionlint`。
