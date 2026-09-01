# Remote terminal tabs resurrected or closed with `tab_not_found` (#11803, #17767)

After a serve restart, a repo/folder catalog could keep pointing at the dead
`runtime:<uuid>` session partition while the worktree's tabs lived in exactly
one other partition — creation and close then hit different stores.

- `RuntimeWorkspaceSessionController` now routes reads/writes to that unique
  durable owner when the catalog-selected runtime partition holds nothing for
  the worktree (`ssh:`/`local` catalog ids stay untouched per the SSH
  execution-boundary rule).
- `terminal stop`'s direct path uses the acknowledged `stopAndWait` instead of
  fire-and-forget `kill`, so the RPC receipt represents durable retirement and
  a restart cannot respawn the tab. One rejecting stop counts as a single
  failure and never aborts the remaining sweep.

Known residual: worktree deletion and hydration surfaces still partition by
catalog host, so a stale-catalog worktree's rows can survive `worktree rm` —
same class as the pre-fix behavior, tracked for follow-up.

Commit: `fix(runtime): route stale catalog worktrees to their unique durable session owner (#11803)`
Commit: `fix(runtime): keep the terminal stop sweep running past a rejecting stopAndWait`
