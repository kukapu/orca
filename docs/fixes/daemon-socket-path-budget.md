# Daemon serves with terminal survival silently off (#17840)

A data root long enough to push `<root>/daemon/daemon-v<N>.sock` past
`sockaddr_un.sun_path` (108 bytes Linux / 104 macOS) killed the daemon at
startup while orcad itself came up healthy — every terminal then died on the
next restart.

The spawner now refuses to fork and `startDaemon` refuses to construct the
server, both with an actionable `DaemonSocketPathTooLongError`.

Commit: `fix(daemon): refuse to serve when the socket path exceeds the sun_path budget (#17840)`
