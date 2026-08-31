# AGENTS.md

## Cursor Cloud specific instructions

Cloud Agent VMs often boot from a prebuilt environment snapshot. Local `main` can lag `origin/main` by an hour or more. Branching from that local ref produces merge conflicts against current `main`.

Before creating a feature branch off the default branch, fetch it first and branch from the remote tip:

```sh
git fetch origin main
git checkout -b <branch> origin/main
```

Do the same for any other base branch the task depends on. Fetch before merging, rebasing, or diffing against latest `main` as well. Do not treat a snapshot checkout of `main` as current.
