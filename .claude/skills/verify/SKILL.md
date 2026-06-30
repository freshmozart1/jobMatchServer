---
name: verify
description: Build the project and run the full Jest test suite. Use this to verify changes are correct before committing. Optionally pass a test file path to run just that file.
disable-model-invocation: true
---

Verify this project's changes by building and running tests.

## Steps

1. **Build first** — Jest runs against compiled output in `dist/`, not source TypeScript:
   ```bash
   npm run build
   ```
   If the build fails, stop and report the TypeScript errors.

2. **Run tests**:
   - If $ARGUMENTS is empty, run the full suite:
     ```bash
     npm run test:once
     ```
     (Do NOT use `npm run test` — it loops forever in watch mode.)

   - If $ARGUMENTS is a file path or pattern, run that specific file:
     ```bash
     node --experimental-vm-modules --localstorage-file=/tmp/jest-localstorage.json ./node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand dist/$ARGUMENTS.test.js
     ```
     Adjust the `dist/` prefix and `.test.js` suffix as needed to match the compiled path.

3. **Report** — summarize what passed, what failed, and any build errors. If tests fail, diagnose and fix the root cause; do not retry without a change.
