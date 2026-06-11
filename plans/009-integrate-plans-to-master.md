# Plan 009: Integrate advisor plan work into default branch

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git status -sb` and `git branch -a` — understand current branch and default branch name before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans 001–008 (all DONE)
- **Category**: dx
- **Planned at**: working tree at v0.6.18, 2026-05-26

## Why this matters

Plans 001–008 were executed on isolated `advisor/*` branches (or a single cumulative branch). The default branch (`master` or `main` — check remote) is still at **`ac922cf`** (v0.6.12 era) unless someone already merged. Until integration:

- CI/releases do not ship the Faytuks-style media work (v0.6.13–0.6.18).
- Multiple `advisor/*` branches may confuse future work.
- Uncommitted files in the working tree are not on any branch until committed.

**Goal:** one clean merge to the default branch, **v0.6.18**, `npm test` green, `dist/` built, ready to push for release.

## Current state (from advisor session)

- **Plans 001–008:** all marked DONE in `plans/README.md`.
- **Expected version:** `0.6.18` in `package.json` and `userscript/metadata.txt`.
- **Expected tests:** `37/37` pass; `npm run check` passes.
- **Known HEAD branch name:** `advisor/008-simplify-preferences` (may have full stack of changes).
- **Other advisor branches that may exist:** `advisor/001-media-extraction-tests`, `advisor/003-…`, `advisor/004-…`, `advisor/005-…`, `advisor/006-…` — each may be **obsolete** if later plans were executed on a newer branch in the same worktree.

**Do not assume** you must merge eight branches. Most sessions accumulate commits on the **latest** advisor branch.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Survey | See Step 1 script | clear A vs B path |
| Tests | `npm test` | 37/37 pass |
| Build | `npm run check` | exit 0 |
| Compare to default | `git log --oneline <default>..HEAD` | shows integration commits |

Use PowerShell `;` not `&&` on Windows.

## Scope

**In scope:**

- Git: survey, commit WIP, integrate to `master` or `main` (whichever is default)
- Include `plans/` directory in the integration commit(s)
- Verify `npm test` && `npm run check` on integration result
- Delete local obsolete `advisor/*` branches after successful merge (optional remote cleanup)

**Out of scope:**

- Force push to default branch
- Rewriting public history on default without explicit user approval
- New feature work
- GitHub release (user pushes; CI publishes if version is new)

## Git workflow

- Integration branch: use existing `advisor/008-simplify-preferences` **or** create `integrate/v0.6.18` from survey result
- Merge target: `master` or `main` (Step 1 determines)
- Commit message style: match repo — e.g. `Release v0.6.18: media attachments, inline quotes, simplified settings`
- Push only if user explicitly asked; this plan ends at local merge + verification unless instructed

## Steps

### Step 1: Survey branches (mandatory — pick Path A or B)

Run in repo root:

```powershell
cd "C:\Users\admin\Desktop\Other\Projects\tweet-share"
git status -sb
git branch -a
$default = if (git show-ref --verify --quiet refs/heads/master) { "master" } else { "main" }
git rev-parse --short $default
git rev-parse --short HEAD
git log --oneline -3 $default
git log --oneline -3 HEAD
git diff --stat "${default}..HEAD"
```

For each local `advisor/*` branch:

```powershell
git branch --list "advisor/*" | ForEach-Object {
  $b = $_.Trim().TrimStart('*').Trim()
  if ($b) {
    "$b ahead of ${default}: $(git rev-list --count "${default}..$b")"
    git log --oneline -1 $b
  }
}
```

**Path A — Single integration branch (usual):**

- `HEAD` is `advisor/008-simplify-preferences` (or similar).
- `git diff --stat default..HEAD` shows **all** plan changes (tests, `13-media-fetch.js`, preferences, `plans/`, version `0.6.18`).
- Other `advisor/*` branches are **behind or equal** to HEAD, or only contain subsets.

→ Proceed with **one merge** (Step 3A). **Do not** merge 001–007 separately.

**Path B — Multiple divergent advisor branches:**

- Two or more `advisor/*` branches each have commits **not** contained in HEAD.
- HEAD does **not** include expected files (e.g. missing `13-media-fetch.js`).

→ Stop and report branch list to operator, OR create `integrate/v0.6.18` from `$default` and merge branches in **dependency order**:

```
001 → 003 → 002 → 004 → 007 → 005 → 006 → 008
```

Resolve conflicts at each merge; run `npm test` after 002, 004, and 008 at minimum.

**Verify:** written note in commit message or report: which path (A or B) was taken.

### Step 2: Commit any uncommitted work on integration branch

```powershell
git status --short
```

If `userscript/`, `tests/`, `plans/`, `package.json`, `dist/` show modifications or untracked `plans/`:

```powershell
git add plans/ userscript/ tests/ package.json userscript/metadata.txt dist/tweet-discord-share.user.js
git status
```

Commit only plan-related files — **do not** add `.agents/`, `skills-lock.json`, or secrets unless user wants them (default: **exclude** `.agents/` and `skills-lock.json`).

```powershell
git commit -m "$(cat <<'EOF'
Integrate plans 001-008: media pipeline, Faytuks polish, simplified settings (v0.6.18).

EOF
)"
```

On PowerShell without heredoc, use a single-line `-m` message with the same meaning.

**Verify:** `git status` clean (or only intentionally ignored files).

### Step 3A: Merge single integration branch to default (Path A)

```powershell
$default = if (git show-ref --verify --quiet refs/heads/master) { "master" } else { "main" }
git checkout $default
git pull origin $default
```

If pull fails (no remote / private repo), continue on local `$default`.

```powershell
git merge advisor/008-simplify-preferences -m "Merge advisor/008: v0.6.18 media and sharing improvements"
```

If integration branch has a different name, use the branch from Step 1 with the full diff.

**Verify:** `git log --oneline -5 $default` shows merge; `package.json` version is `0.6.18`.

### Step 3B: (Path B only) Sequential merges

Checkout `$default`, create `integrate/v0.6.18`, merge each advisor branch in dependency order, resolve conflicts, `npm test` after critical merges. Final merge `integrate/v0.6.18` → `$default`.

### Step 4: Verification gate on default branch

```powershell
npm test
npm run check
```

Expected:

- **37/37** tests pass
- `dist/tweet-discord-share.user.js` exists, `@version 0.6.18`
- `userscript/src/10-preferences.js` has only `alwaysShowPreview` and `attachMedia`
- `userscript/src/13-media-fetch.js` exists

**Verify:** both commands exit 0.

### Step 5: Manual smoke checklist (operator)

Share one tweet in Tampermonkey with built `dist/tweet-discord-share.user.js`:

1. Quote + video (Jamie-style) — one embed, inline quote field, content URLs, video attachment.
2. Settings — **two** toggles only.
3. Toggle upload off — link-mode fallback still works.

Record pass/fail in merge commit message or PR description. If manual test fails, **do not push** — stop and report.

### Step 6: Clean up stale advisor branches (local)

After successful merge and tests:

```powershell
git branch --merged $default | Select-String "advisor/"
```

Delete merged advisor branches:

```powershell
git branch -d advisor/001-media-extraction-tests
# ... other merged advisor/* branches
```

Do **not** delete unmerged branches without listing them for the operator.

**Verify:** `git branch` shows `$default` and no obsolete `advisor/*` (or only intentionally kept ones).

### Step 7: Push and release (only if user requested push)

```powershell
git push origin $default
```

CI (per README) publishes release when `package.json` version `v0.6.18` is new on remote.

**Verify:** GitHub release or CI green if applicable.

## Test plan

- Automated: full `npm test` + `npm run check` on merged `$default`
- Manual: two smoke shares (Step 5)

## Done criteria

- [ ] Survey documented: Path A or B
- [ ] `$default` branch contains v0.6.18 code and `plans/` directory
- [ ] `npm test` → 37/37; `npm run check` → exit 0
- [ ] No uncommitted plan work left on integration branch
- [ ] Stale merged `advisor/*` branches removed locally (or listed if kept)
- [ ] `plans/README.md` plan 009 → DONE
- [ ] Operator informed: ready to `git push` for release (if not pushed by executor)

## STOP conditions

- Path B with conflicting merges you cannot resolve — stop, list conflict files
- `npm test` fails on merged `$default` — stop, do not push
- `HEAD` diff vs `$default` missing `13-media-fetch.js` or version < 0.6.18 — wrong branch; re-run survey
- Default branch is not `master` or `main` — stop and report actual default from `git remote show origin`

## Maintenance notes

- After integration, future improvements use new `advisor/NNN-*` branches from updated `$default`.
- Keep `plans/` in repo as the audit trail; index already marks 001–008 DONE.
- If release CI expects `main` but you merged to `master`, align branch names with README before push.
