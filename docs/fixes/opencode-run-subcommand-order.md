# OpenCode commit-message flags reorder ahead of `run` and change the command (#17551)

An OpenCode agent command override like `opencode --auto` was prepended
verbatim, yielding `opencode --auto run ...`: OpenCode parses pre-`run`
flags as global flags, so the invoked command changed.

For a bare `opencode` / `opencode.cmd` / `opencode.exe` binary the plan now
anchors command-override flags right after the `run` subcommand
(`opencode run --auto --model ...`). Wrapper prefixes such as `npx opencode`
and prefixes containing an option terminator are left in place.

Commit: `fix(opencode): preserve the run subcommand before launch flags (#17551)`
