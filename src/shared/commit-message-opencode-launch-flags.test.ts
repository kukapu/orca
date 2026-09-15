import { describe, expect, it } from 'vitest'
import { planCommitMessageGeneration } from './commit-message-plan'
import { orderOpenCodeRunFlags } from './opencode-run-flag-order'

describe('OpenCode commit-message launch flags', () => {
  it.each(['opencode', 'opencode.cmd', 'opencode.exe'])(
    'places OpenCode launch flags after the run subcommand for %s',
    (agentCommandOverride) => {
      const result = planCommitMessageGeneration(
        {
          agentId: 'opencode',
          model: 'opencode/gpt-5.4-mini',
          agentCommandOverride: `${agentCommandOverride} --auto`
        },
        'PROMPT'
      )

      expect(result).toEqual({
        ok: true,
        plan: {
          binary: agentCommandOverride,
          args: [
            'run',
            '--auto',
            '--model',
            'opencode/gpt-5.4-mini',
            '--agent',
            'build',
            '--format',
            'default'
          ],
          stdinPayload: 'PROMPT',
          label: 'OpenCode'
        }
      })
    }
  )

  it('moves an npx opencode flag tail after the run subcommand', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'opencode',
        model: 'opencode/gpt-5.4-mini',
        agentCommandOverride: 'npx opencode --auto'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'npx',
        args: [
          'opencode',
          'run',
          '--auto',
          '--model',
          'opencode/gpt-5.4-mini',
          '--agent',
          'build',
          '--format',
          'default'
        ],
        stdinPayload: 'PROMPT',
        label: 'OpenCode'
      }
    })
  })
})

describe('orderOpenCodeRunFlags passthrough branches (#17551)', () => {
  it('passes a prefix through when the generated args do not start with run', () => {
    expect(orderOpenCodeRunFlags('opencode', 'opencode', ['--auto'], ['serve'])).toEqual([
      '--auto',
      'serve'
    ])
  })

  it('passes a prefix through when it already contains its own run subcommand', () => {
    expect(
      orderOpenCodeRunFlags('opencode', 'opencode', ['--auto', 'run'], ['run', '--model', 'm'])
    ).toEqual(['--auto', 'run', 'run', '--model', 'm'])
  })

  it('passes a prefix through when it contains an option terminator', () => {
    expect(
      orderOpenCodeRunFlags(
        'opencode',
        'npx',
        ['opencode', '--', '--auto'],
        ['run', '--model', 'm']
      )
    ).toEqual(['opencode', '--', '--auto', 'run', '--model', 'm'])
  })

  it('passes non-opencode agents through regardless of prefix shape', () => {
    expect(orderOpenCodeRunFlags('claude', 'claude', ['--model', 'opus'], ['-p'])).toEqual([
      '--model',
      'opus',
      '-p'
    ])
  })
})
