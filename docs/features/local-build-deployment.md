# Local build + deploy of this fork

This server runs its own AppImage built from `main-kukapu`:

```
ORCA_LOCAL_BUILD_VERSION=1.4.194-kukapu.N pnpm build:linux
sudo -n bash /tmp/opencode/install-orca-v1.4.194-kukapu.1.sh   # backup → swap → restart → checks
```

- Version is stamped via `ORCA_LOCAL_BUILD_VERSION`; `/opt/orca/VERSION`
  records it and `orca-ide status --json` reports it.
- Rollback: copy the timestamped backup from `/opt/orca/backups/` over
  `/opt/orca/orca-linux.AppImage` and restart both services.
- The glibc-floor gate runs at packaging; it is what caught the node-pty
  cfset*speed issue (see `docs/fixes/node-pty-glibc-2-42-cfset.md`).
- Smoke-test a fresh build without touching production:
  isolated `HOME`/`XDG_CONFIG_HOME` + `--port 6799`.
