# GitHub PR 治理流程

GameForge 社区仓库采用五层 GitHub 流程。Git commit、GitHub PR 和 GitHub 原生保护规则仍是权威状态；Agent 会话与 Agentic Workflow 输出都不是 GameForge Task/Run 的替代状态源。

## 五层职责

| 层级 | 生命周期 | 职责 | 明确不做 |
|---|---|---|---|
| `yeet` | 当前交互会话 | 建分支、stage、按逻辑 commit、push、创建或更新 Draft PR | 不审批、不合并 |
| `pr-babysitter` | 当前 Agent 会话 | 处理冲突、CI 失败和评审意见，报告合并就绪状态 | 不在会话结束后假装持续运行，不默认合并 |
| GitHub Agentic Workflows | GitHub Actions 事件或定时运行 | `GameForge PR Reviewer` 提交合并级 review；`GameForge PR Comment Fixer` 在显式 opt-in 后修复评审意见；`GameForge PR Guardian` 诊断阻断项 | Agent job 始终只读；写入只能经过 safe outputs |
| 确定性 Auto-merge Gate | CI 或 Reviewer 完成后 | 核对最新 Head SHA、三平台 CI、APPROVED、零未解决线程、分支保护和 `auto-merge` 标签，再启用 GitHub 原生 squash auto-merge | 不直接 merge、不绕过保护规则、不处理 fork PR |
| GitHub Auto-merge | GitHub 原生合并队列 | required checks、required review 和会话解决条件全部满足后 squash merge | 不绕过保护规则 |

PR 可以面向 `main` 或其他维护分支。PR 标题采用 `<type>(<scope>): <subject>`；自动化将 `feat`、`fix`、`docs` 等 `type` 映射为同名 GitHub label。这里使用的是 PR label，不创建同名 Git tag；Git tag 只保留给经授权的版本发布。

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
- Comment Fixer 只处理带 `auto-fix-review` 标签的同仓库、非 Draft PR，并且只接受由 `github-actions[bot]` 对当前 Head SHA 提交、且含 GameForge Reviewer 机器标记的 `REQUEST_CHANGES`，或 OWNER/MEMBER 的人工评论触发。依赖安装禁用 lifecycle scripts；GitHub App 私钥只进入 safe-output job，用于 push、回复和 resolve，不进入 Agent job；Fixer 不能修改 workflow、`.github/aw/**` 或 `AGENTS.md`，也不能审批或合并。
- Guardian 只能创建一条去重后的诊断 issue，不能写代码、push、审批或 merge。
- Auto-merge 由无 Agent 的确定性 gate 启用，并由 GitHub 原生能力执行；不采用仍处于实验状态的 Agentic `merge-pull-request` safe output。

三个 Agentic Workflow 均使用 Codex 和 OpenAI-compatible Responses endpoint `https://api.sein.moe/v1/`：

| 工作流 | 模型 | 原因 |
|---|---|---|
| `GameForge PR Reviewer` | `gpt-5.6-sol` | 唯一合并审批属于低频、高风险判断，优先使用旗舰推理与编码能力 |
| `GameForge PR Comment Fixer` | `gpt-5.6-terra` | 评审修复需要较强编码能力，但每次 push 仍由完整 Bun 验证和后续 Reviewer 复核约束 |
| `GameForge PR Guardian` | `gpt-5.6-terra` | CI 诊断与定时巡检需要较强推理，但适合平衡质量与成本 |

`gpt-5.6-luna` 暂不参与合并审批。高频、低风险、可确定性复核的分类工作优先使用普通 GitHub Action；以后只有出现足够大的非确定性摘要负载时才评估 Luna。

修改 Agentic Workflow frontmatter 后运行：

```powershell
gh aw compile --strict --validate --actionlint
```

## 首次启用

Agentic Workflow 默认由仓库变量 `GAMEFORGE_GH_AW_ENABLED=false` 关闭，避免凭据未配置时产生失败运行。维护者应把自有 endpoint 的 Key 直接写入 GitHub Secret；不要在聊天、命令历史、仓库文件或实验记录中粘贴 Key：

```powershell
gh secret set GAMEFORGE_CODEX_API_KEY --repo K4F7/GameForge-Agent
gh variable set GAMEFORGE_GH_AW_ENABLED --body true --repo K4F7/GameForge-Agent
```

启用后，先用一个无业务风险的 PR 验证：Reviewer 能读取 diff、safe output 能提交 `APPROVE` 或 `REQUEST_CHANGES`、审批能满足 `main` 的 required review、Guardian 能在手工 dispatch 下无阻断时执行 `noop`。未完成这组证据前，不把后台 Agent 记为端到端通过。

Comment Fixer 需要一个安装到本仓库的 GitHub App。App 最小仓库权限为 Contents read/write、Pull requests read/write 和 Administration read；Administration read 仅供 gh-aw 在 push 前读取分支保护，不能修改仓库设置。Client ID 放入 Actions variable，私钥只放入 Actions secret。Actions 和 Checks 的只读访问继续使用 Agent job 的仓库 `GITHUB_TOKEN`：

```powershell
gh variable set GAMEFORGE_AUTOMATION_APP_CLIENT_ID --body "<app-client-id>" --repo K4F7/GameForge-Agent
gh secret set GAMEFORGE_AUTOMATION_APP_PRIVATE_KEY --repo K4F7/GameForge-Agent
gh variable set GAMEFORGE_PR_AUTOMATION_ENABLED --body true --repo K4F7/GameForge-Agent
gh label create auto-fix-review --color 0E8A16 --description "Allow the review fixer to push verified changes" --repo K4F7/GameForge-Agent
gh label create auto-merge --color 1D76DB --description "Enable native auto-merge after every gate passes" --repo K4F7/GameForge-Agent
```

不得把 GitHub App 私钥粘贴到聊天、命令参数、仓库文件或实验记录。没有 App 配置时保持 `GAMEFORGE_PR_AUTOMATION_ENABLED=false`。实际目标分支必须先有 legacy branch protection，至少要求三平台 Bun checks、一个 approving review、最后 push 后重新审批和解决全部 review conversations；否则确定性 gate 会拒绝启用 auto-merge。当前 gate 通过 Branch API 的 `protected` 状态验证这一要求，不支持仅由 Ruleset 提供保护的目标分支。仓库权限和分支保护属于远程治理状态，必须经维护者明确授权后配置。

## 日常流程

1. 使用 `yeet` 创建或更新 Draft PR。
2. 在当前会话使用 `pr-babysitter` 修复 CI、冲突和可执行的 review 意见。需要后台自动修复时，显式添加 `auto-fix-review` 标签。
3. 完成人工自检后将 PR 标记为 ready；`GameForge PR Reviewer` 随 `ready_for_review` 运行。
4. 新 push 会撤销旧批准并触发新的 review，防止旧结论覆盖新代码。
5. 对确定要自动合并的 PR 显式添加 opt-in 标签：

   ```powershell
   gh pr edit <number> --add-label auto-merge
   ```

首次安装时，必须先将 `GameForge Auto Merge Gate` 工作流合并到默认分支；`workflow_run` 只会对默认分支上已存在的工作流触发，因此仅把 Gate 放在当前 PR head 上不能让该 PR 自举启用 auto-merge。合并工作流后，再用一个低风险 PR 验证 Gate 的完整链路。

6. `GameForge Auto Merge Gate` 在 CI 或 Reviewer 成功后核验最新 SHA、三平台 CI、`gh-aw` approval、零未解决线程和分支保护，再通过 GraphQL 启用原生 squash auto-merge。
7. GitHub 只会在目标分支的所有保护门禁持续满足时完成合并。任何新的 push 都必须重新运行 CI 和 Reviewer。

Draft PR 不排入 Auto-merge。没有 `auto-merge` 标签时 gate 只跳过，不改变 PR。没有明确合并意图时只报告 ready，不执行第 5 步。

## 官方依据

- [GitHub Agentic Workflows Quick Start](https://github.github.com/gh-aw/setup/quick-start/)（访问日期：2026-07-19）
- [GitHub Agentic Workflows Safe Outputs](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/)（访问日期：2026-07-19）
- [GitHub Agentic Workflows Authentication](https://github.github.com/gh-aw/reference/auth/)（访问日期：2026-07-19）
- [GitHub：About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)（访问日期：2026-07-19）
- [GitHub：Managing auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)（访问日期：2026-07-19）
- [GitHub：`GITHUB_TOKEN` event recursion](https://docs.github.com/en/actions/concepts/security/github_token)（访问日期：2026-07-19）
