# AI commit messages / PR descriptions fail with UnknownError on OpenCode (#17691, #15801)

OpenCode retired the free model the spec shipped as default
(`opencode/deepseek-v4-flash-free`), so `opencode run --model <stale>` failed
with an opaque `UnknownError` and the static catalog entry masked the
discovery correction.

When the host's model discovery has answered, a model id absent from its
output now never reaches the CLI — it falls back to the spec default if it
survives there, else the first discovered model (same policy as
`finalizeModelDiscoveryOutput`). Static OpenCode catalog refreshed to the
current free tier (`opencode/mimo-v2.5-free`).

Commit: `fix(source-control): heal retired model ids against live discovery output (#17691)`
