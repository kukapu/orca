import { vi } from 'vitest'

const worktrees = [
  {
    path: '/tmp/worktree-a',
    head: 'abc',
    branch: 'feature/prompt-verification',
    isBare: false,
    isMainWorktree: false
  }
]

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue(worktrees),
  listWorktreesStrict: vi.fn().mockResolvedValue(worktrees)
}))
