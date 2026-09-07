# OpenCode worker launch models

Orchestration workers can launch OpenCode with a per-invocation model:
`orca orchestration worker-start --agent opencode --model zai-coding-plan/glm-5.3`
(nested `provider/model` ids accepted; `--effort` stays rejected until OpenCode
grows a launch-time variant flag).

Upstream PR: #17700.
Commits: `feat(orchestration): support OpenCode worker launch models`,
`fix(orchestration): accept nested OpenCode model ids`,
`docs(orchestration): state OpenCode --effort restriction in worker-start notes`
