# OpenCode commit-message flags reorder ahead of `run` and change the command (#17551)

An OpenCode agent command override like `opencode --auto` was prepended
verbatim, yielding `opencode --auto run ...`: OpenCode parses pre-`run`
flags as global flags, so the invoked command changed.

Only provably-safe shapes reorder: a bare opencode binary with a pure flag
tail (`opencode --auto` → `opencode run --auto ...`), or a wrapper with a
positional anchor before its flags (`npx opencode --auto` → `npx opencode
run --auto ...`). Everything else passes through verbatim — wrappers whose
flags precede the positional (`npx -y opencode`, which would run a package
named `run`), tails with non-flag tokens (`--model X` is a valid global
anyway), and prefixes carrying an option terminator or their own `run`.

Commit: `fix(opencode): preserve the run subcommand before launch flags (#17551)`
Commit: `fix(opencode): move the whole flag tail after run for wrapper overrides (#17551)`
