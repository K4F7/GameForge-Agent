# GitHub PR 治理流程

GameForge 社区仓库采用四层 GitHub 流程。Git commit、GitHub PR 和 GitHub 原生保护规则仍是权威状态；Agent 会话与 Agentic Workflow 输出都不是 GameForge Task/Run 的替代状态源。

## 四层职责

| 层级 | 生命周期 | 职责 | 明确不做 |
|---|---|---|---|
| `yeet` | 当前交互会话 | 建分支、stage、按逻辑 commit、push、创建或更新 Draft PR | 不审批、不合并 |
| `pr-babysitter` | 当前 Agent 会话 | 处理冲突、CI 失败和评审意见，报告合并就绪状态 | 不在会话结束后假装持续运行，不默认合并 |
| GitHub Agentic Workflows | GitHub Actions 事件或定时运行 | `GameForge PR Reviewer` 提交合并级 review；`GameForge PR Guardian` 在 CI 失败和工作日定时诊断阻断项 | 不直接 merge；Guardian 不写代码、不 push |
| GitHub Auto-merge | GitHub 原生合并队列 | required checks、required review 和会话解决条件全部满足后 squash merge | 不绕过保护规则 |

## Required checks

`main` 分支要求以下 CI contexts 成功，并要求分支与 `main` 保持最新：

- `bun (ubuntu-latest)`
- `bun (windows-latest)`
- `bun (macos-latest)`

还要求一个 approving review、最后一次 push 后重新批准、解决所有 review conversations，并对管理员同样执行保护规则。批准由 `GameForge PR Reviewer` 的 `gh-aw` safe output 提交；PR 作者无需也不能自审。

## Agentic Workflow 安全边界

Agentic Workflow 源文件为 `.github/workflows/*.md`，提交时必须同时包含由官方 `gh aw compile` 生成的 `*.lock.yml`。锁文件标记为生成文件，不得手改。

- Agent job 使用只读权限和 `min-integrity: approved`。
- Review 和 issue 只能通过 `gh-aw` safe outputs 产生。
- Reviewer 最多写十条行内意见和一条汇总 review。
- Guardian 只能创建一条去重后的诊断 issue，不能写代码、push、审批或 merge。
- Auto-merge 由 GitHub 原生能力执行，不采用仍处于实验状态的 Agentic `merge-pull-request` safe output。

修改 Agentic Workflow frontmatter 后运行：

```powershell
gh aw compile --strict --validate --actionlint
```

## 首次启用

Agentic Workflow 默认由仓库变量 `GAMEFORGE_GH_AW_ENABLED=false` 关闭，避免凭据未配置时产生失败运行。维护者应在本机创建只具有 Copilot Requests 权限的 fine-grained token，并直接写入 GitHub Secret；不要在聊天、命令历史、仓库文件或实验记录中粘贴 token：

```powershell
gh secret set COPILOT_GITHUB_TOKEN --repo K4F7/GameForge-Agent
gh variable set GAMEFORGE_GH_AW_ENABLED --body true --repo K4F7/GameForge-Agent
```

启用后，先用一个无业务风险的 PR 验证：Reviewer 能读取 diff、safe output 能提交 `APPROVE` 或 `REQUEST_CHANGES`、审批能满足 `main` 的 required review、Guardian 能在手工 dispatch 下无阻断时执行 `noop`。未完成这组证据前，不把后台 Agent 记为端到端通过。

## 日常流程

1. 使用 `yeet` 创建或更新 Draft PR。
2. 在当前会话使用 `pr-babysitter` 修复 CI、冲突和可执行的 review 意见。
3. 完成人工自检后将 PR 标记为 ready；`GameForge PR Reviewer` 随 `ready_for_review` 运行。
4. 新 push 会撤销旧批准并触发新的 review，防止旧结论覆盖新代码。
5. 对确定要自动合并的 PR 显式执行：

   ```powershell
   gh pr merge --auto --squash
   ```

6. GitHub 只会在三平台 CI、`gh-aw` approval 和会话解决门禁全部满足后合并。

Draft PR 不排入 Auto-merge。没有明确合并意图时只报告 ready，不执行第 5 步。

## 官方依据

- [GitHub Agentic Workflows Quick Start](https://github.github.com/gh-aw/setup/quick-start/)（访问日期：2026-07-19）
- [GitHub Agentic Workflows Safe Outputs](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/)（访问日期：2026-07-19）
- [GitHub：About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)（访问日期：2026-07-19）
- [GitHub：Managing auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)（访问日期：2026-07-19）
