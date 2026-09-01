# node-pty builds reference GLIBC_2.42 on current hosts

glibc 2.42 turns `cfsetispeed`/`cfsetospeed` into real versioned libc symbols
(inline helpers before), so node-pty compiled on this host failed the Ubuntu
20.04 glibc-floor gate at packaging.

The node-pty patch now writes `c_cflag`'s `CBAUD` bits directly with the old
inline semantics on Linux; macOS keeps the libc calls. Lockfile patch hash
updated in a follow-up commit.

Commits: `fix(build): keep node-pty on the glibc floor when cfset*speed become real symbols`,
`chore: update node-pty patch hash in lockfile`
