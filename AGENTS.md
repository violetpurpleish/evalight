# AGENTS.md

## Chrome browser tests on macOS

Run Puppeteer/Chrome browser tests with the required permission to launch Chrome outside the restricted execution sandbox. Request tool-level escalation before launching these tests rather than first attempting a sandboxed launch. Headless Chrome still interacts with macOS application services and can produce a visible crash dialog when startup fails.

Observed crash reports showed `SIGABRT` during `_RegisterApplication` / `TransformProcessType`. This suggests a launch-environment issue, but does not conclusively establish the cause. If this happens, inspect the crash report and launch permissions before attributing the failure to Evalight. Chrome's `--no-sandbox` flag does not grant permission to bypass the agent's execution sandbox.

## Cursor Cloud specific instructions

Cloud Agent VMs often boot from a prebuilt environment snapshot. Local `main` can lag `origin/main` by an hour or more. Branching from that local ref produces merge conflicts against current `main`.

Before creating a feature branch off the default branch, fetch it first and branch from the remote tip:

```sh
git fetch origin main
git checkout -b <branch> origin/main
```

Do the same for any other base branch the task depends on. Fetch before merging, rebasing, or diffing against latest `main` as well. Do not treat a snapshot checkout of `main` as current.
