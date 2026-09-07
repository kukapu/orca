# Pi worker launch models

Orchestration workers can launch Pi with a model and thinking level:
`orca orchestration worker-start --agent pi --model google/gemini-3-pro --effort xhigh`
(`--effort` maps to Pi's `--thinking` ladder). The thinking ladder and table
parser are shared with the session-option catalog instead of forked.

Upstream PR: #17704.
Commits: `feat(orchestration): support Pi worker launch models`,
`fix(orchestration): share Pi thinking ladder and table parser`
