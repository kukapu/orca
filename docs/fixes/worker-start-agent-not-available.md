# worker-start injects the task into a bare shell when the agent CLI is missing (#17943)

`orchestration worker-start --agent claude` on a host without the `claude`
executable recorded `claude` as the effective agent, spawned a plain zsh,
injected the task prompt into it (`zsh: parse error near ')'`), and failed as
`agent_prompt_stalled` with a residual terminal.

Both start paths now fence the requested agent against the execution host
before any resource exists:

- `orchestration.workerStart` — against the requested repo's host for
  `new-child`/`new-top-level` (the spawn host, which need not be the
  coordinator's), and against the requested worktree's host otherwise
  (local, a WSL distro, or an SSH-connection workspace).
- `orchestration.federationAttachStart` — the worker server itself, by repo
  or worktree, before the remote attachment record exists.

A host that answers without the agent fails fast with the structured
`agent_not_available` error and zero residual resources. The home side
settles a remote fence as `failed`, not `outcome_unknown`, because a missing
CLI will not fix itself on retry. Mixed versions degrade safely: an older
coordinator classifies the new code as `outcome_unknown` and retries into the
same fence — wasted retries, never a wrong start.

Every unverifiable path fails open, per the SSH execution boundary:

- a user `agentCmdOverrides` entry (host inventory cannot describe it);
- runtime-specific agents on runtimes where PATH detection does not describe
  them — `claude-agent-teams` falls back to Claude's in-process mode on
  win32/wsl, and a remote host's runtime is unknown from the coordinator;
- an unreachable SSH host (loss of contact is never absence);
- a failed probe (a failed probe is "could not run it", never "not installed");
- an unresolvable workspace scope (the spawn path raises the real error).

The fence may only answer "no" when the host positively did.

Commit: `fix(orchestration): fence worker-start agents against the execution host (#17943)`
