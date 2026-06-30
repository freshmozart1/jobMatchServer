---
name: fix-issue
description: End-to-end workflow for implementing a GitHub issue in this repo. Reads the issue, implements the fix, builds, runs relevant tests, and opens a PR with a conventional commit message.
disable-model-invocation: true
---

You are implementing a GitHub issue for this repository. $ARGUMENTS should be an issue number (e.g. `42`).

## Steps

1. **Read the issue** using `gh issue view $ARGUMENTS` to understand what needs to change.

2. **Explore the relevant code** — identify which files need to change. Use the issue description, labels, and linked code to narrow the scope.

3. **Implement the fix** — make the minimal change that resolves the issue. Follow the conventions in CLAUDE.md:
   - Local imports must end in `.js`
   - Type-only imports use `import type`
   - Update both `package.json` imports and `tsconfig.json` paths if adding a new path alias

4. **Build and test**:
   ```bash
   npm run build
   ```
   If there are relevant test files, run them:
   ```bash
   node --experimental-vm-modules --localstorage-file=/tmp/jest-localstorage.json ./node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand dist/path/to/relevant.test.js
   ```
   Fix any build errors or test failures before continuing.

5. **Create a branch** named after the issue type and number:
   - `feat/issue-$ARGUMENTS-<short-description>` for features
   - `fix/issue-$ARGUMENTS-<short-description>` for bugs
   - `refactor/issue-$ARGUMENTS-<short-description>` for refactors

6. **Commit** with a conventional message:
   ```
   type: short description (closes #$ARGUMENTS)
   ```

7. **Open a PR** targeting `master`:
   ```bash
   gh pr create --title "type: short description (closes #$ARGUMENTS)" --body "..."
   ```

Report the PR URL when done.
