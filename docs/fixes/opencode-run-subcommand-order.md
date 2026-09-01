# OpenCode commit-message flags reorder ahead of `run` and change the command (#17551)

An OpenCode agent command override like `opencode --auto` was prepended
verbatim, yielding `opencode --auto run ...`: OpenCode parses pre-`run`
flags as global flags, so the invoked command changed.

The rule is shape-based: any OpenCode prefix — bare binary or a wrapper like
`npx opencode --auto` — has its flag tail (flags and their values, a suffix)
anchored right after the `run` subcommand, with leading positionals kept in
front (`npx opencode run --auto --model ...`). Prefixes containing an option
terminator or their own `run` are left in place, as are non-`run` base args.

Commit: `fix(opencode): preserve the run subcommand before launch flags (#17551)`
