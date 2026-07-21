---
name: fix-issue
description: Use when the user asks to implement, fix, or resolve a specific GitHub issue by number in this repository (e.g. "/fix-issue 42", "fix issue 42").
disable-model-invocation: true
---

You are implementing a GitHub issue for this repository. $ARGUMENTS should be an issue number (e.g. `42`).

## Steps

1. **Read the issue** with `gh issue view $ARGUMENTS` to understand what needs to change.

2. **Plan the fix in plan mode.** Call `EnterPlanMode`, explore the affected code, and write an implementation plan covering the approach, the files to change, and how it satisfies CLAUDE.md conventions (local imports end in `.js`, type-only imports use `import type`, new path aliases go in both `package.json` and `tsconfig.json`). Don't edit files yet. Call `ExitPlanMode` once the plan is ready — approval returns you to normal (auto) permission mode.

3. **Create a branch** off `master`, named after the issue type and number:
   - `feat/issue-$ARGUMENTS-<short-description>` for features
   - `fix/issue-$ARGUMENTS-<short-description>` for bugs
   - `refactor/issue-$ARGUMENTS-<short-description>` for refactors

4. **Save the approved plan as the branch description**, so reviewers can see the intended approach before any code lands:

   ```bash
   git config branch.<branch-name>.description "$(cat <<'EOF'
   <the approved plan>
   EOF
   )"
   ```

5. **Open a draft PR before implementing.** GitHub rejects a PR with no diff from `master`, so give the branch one empty commit to push first:

   ```bash
   git commit --allow-empty -m "chore: start work on issue #$ARGUMENTS"
   git push -u origin <branch-name>
   gh pr create --draft --base master \
     --title "type: short description (closes #$ARGUMENTS)" \
     --body "Closes #$ARGUMENTS. Implements the plan below.\n\n<the approved plan>"
   ```

6. **Implement the plan** — make the minimal change that resolves the issue, following the plan and the CLAUDE.md conventions above.

7. **Build and test**:

   ```bash
   npm run build
   ```

   If there are relevant test files, run them:

   ```bash
   node --experimental-vm-modules --localstorage-file=/tmp/jest-localstorage.json ./node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand dist/path/to/relevant.test.js
   ```

   Fix any build errors or test failures. Do not commit until the build and all relevant tests are clean.

8. **Commit** once build and tests pass, with a conventional message matching the branch/PR title:

   ```
   type: short description (closes #$ARGUMENTS)
   ```

   Push the commit — it updates the existing draft PR.

Report the PR URL when done.
