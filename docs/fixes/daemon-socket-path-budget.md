# Daemon serves with terminal survival silently off (#17840)

A data root long enough to push `<root>/daemon/daemon-v<N>.sock` past
`sockaddr_un.sun_path` (108 bytes Linux / 104 macOS) killed the daemon at
startup while orcad itself came up healthy — every terminal then died on the
next restart.

The spawner now refuses to fork and `startDaemon` refuses to construct the
server, both with an actionable `UnixSocketPathTooLongError`. The runtime's
own RPC socket (`o-<pid>-<suffix>.sock`, only a few bytes shorter) is guarded
by the same budget in `UnixSocketTransport.start`, so a long data root now
fails loudly at both endpoints instead of dying later with a raw listen EINVAL.

Commit: `fix(daemon): refuse to serve when the socket path exceeds the sun_path budget (#17840)`
Commit: `fix(runtime): guard the runtime RPC socket against the sun_path budget (#17840)`
