# pi-family agents stop reporting status forever after a restart (#16109)

Agent restarts make the new processes inherit the previous owner's pid, so the
`ORCA_PI_STATUS_OWNED` guard suppressed all status reporting permanently.

The generated extension now probes the recorded owner with `kill(pid, 0)`:
a dead or malformed owner is claimable again; a live foreign owner (EPERM
counts as alive) keeps the suppression so inherited child agents still do not
double-report. Known residual: a recycled pid (reused by an unrelated process)
reports alive and suppresses again — an identity nonce would close it; every
failure mode degrades to suppression, never double-reporting.

Commit: `fix(pi): reclaim status ownership from a dead owner pid (#16109)`
