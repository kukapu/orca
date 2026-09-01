# AI commit messages / PR descriptions fail with UnknownError on OpenCode (#17691, #15801)

OpenCode retired the free model the spec shipped as default
(`opencode/deepseek-v4-flash-free`), so `opencode run --model <stale>` failed
with an opaque `UnknownError`.

Healing is spec-driven, never discovery-driven: each spec can declare
`retiredModelIds` (opencode lists the retired free-tier default); when the
resolved model id is retired, the plan falls back to the spec default (if not
itself retired) or the first non-retired static entry. Persisted discovery
lists are frozen legacy data (their writer was removed in #4868), so they must
never authorize substitutions — a valid current choice always wins over a
stale list. Static OpenCode catalog refreshed to the current free tier
(`opencode/mimo-v2.5-free`).

Commits: `fix(source-control): heal retired model ids against live discovery output (#17691)`,
`fix(source-control): heal only known-retired model ids instead of trusting frozen discovery data (#17691)`
