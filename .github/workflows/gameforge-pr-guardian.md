---
name: GameForge PR Guardian
description: Diagnose failed CI runs and periodically report blockers on open pull requests after interactive agent sessions end.

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches:
      - main
      - "feat/**"
      - "fix/**"
      - "docs/**"
      - "chore/**"
      - "refactor/**"
      - "test/**"
  schedule: daily on weekdays
  workflow_dispatch:

if: ${{ vars.GAMEFORGE_GH_AW_ENABLED == 'true' && (github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'failure') }}

engine:
  id: codex
  model: gpt-5.6-terra
  env:
    OPENAI_BASE_URL: "https://api.sein.moe/v1/"
    OPENAI_API_KEY: ${{ secrets.GAMEFORGE_CODEX_API_KEY }}

permissions:
  actions: read
  checks: read
  contents: read
  issues: read
  pull-requests: read

network:
  allowed:
    - defaults
    - api.sein.moe

tools:
  github:
    min-integrity: approved
    toolsets: [pull_requests, repos, actions, issues]

safe-outputs:
  mentions: false
  allowed-github-references: []
  create-issue:
    title-prefix: "[pr-guardian] "
    labels: [automation, governance]
    close-older-issues: true
    max: 1

timeout-minutes: 10
---

# GameForge PR guardian

Act as the background handoff after interactive `pr-babysitter` sessions. Diagnose and report; do not modify code, push branches, approve reviews, enable auto-merge, or merge pull requests.

## Event behavior

- For a failed `workflow_run`, inspect run `${{ github.event.workflow_run.id }}`, its failed jobs and logs, the associated commit, and any associated open pull request.
- For a scheduled or manual run, inspect all open, non-draft pull requests and report only actionable blockers or state transitions: failed checks, conflicts, missing GameForge reviewer approval, or unresolved review conversations.
- Search recent open `[pr-guardian]` issues before reporting. Consolidate related failures and avoid duplicating an equivalent report.

## Report requirements

Create at most one concise issue containing:

- affected pull request or workflow-run links;
- observed failing check, conflict, or review state;
- the smallest likely remediation with repository-relative paths when known;
- whether the problem appears to be code, dependency, flaky test, runner, or external infrastructure;
- explicit uncertainty where evidence is incomplete.

If no actionable blocker exists, use the `noop` safe output and do not create an issue. Never expose secrets or reproduce credential-like log values.
