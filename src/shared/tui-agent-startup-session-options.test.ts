import { describe, expect, it } from 'vitest'
import {
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan,
  buildAgentStartupPlan
} from './tui-agent-startup'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'
import { resolveTuiAgentLaunchArgs } from './tui-agent-launch-defaults'
import { tokenizeStartupCommand } from './tui-agent-startup-shell'

describe('tui agent startup session options', () => {
  it('emits catalog options before user arguments without recording an overridden model', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'opus', effort: 'xhigh', fastMode: true },
      agentArgs: '--model haiku'
    })
    expect(plan?.launchCommand).toBe("claude '--model' 'opus' '--effort' 'xhigh' '--model' 'haiku'")
    expect(plan?.sessionOptions).toBeUndefined()
  })

  it('keeps the model record but drops an effort overridden by user arguments', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'opus', effort: 'xhigh' },
      agentArgs: '--effort low'
    })
    expect(plan?.sessionOptions).toEqual({ model: 'opus' })
  })

  it('lets explicit worker preferences override general agent arguments', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'custom-codex-model', effort: 'high' },
      sessionOptionsOverrideAgentArgs: true,
      agentArgs: '-m gpt-5.5 -c model_reasoning_effort=low'
    })
    expect(plan?.launchCommand).toBe(
      "codex '-m' 'custom-codex-model' '-c' 'model_reasoning_effort=high'"
    )
    expect(plan?.launchConfig.agentCommand).toBe(
      "codex '-m' 'gpt-5.5' '-c' 'model_reasoning_effort=low'"
    )
    expect(plan?.sessionOptions).toEqual({ model: 'custom-codex-model', effort: 'high' })
  })

  it('launches an OpenCode worker with a model without persisting it', () => {
    const plan = buildAgentStartupPlan({
      agent: 'opencode',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'xai/grok-4.6' },
      sessionOptionsOverrideAgentArgs: true,
      agentArgs: '--continue'
    })
    expect(plan?.launchCommand).toBe("opencode '--continue' '--model' 'xai/grok-4.6'")
    expect(plan?.launchConfig.agentCommand).toBe("opencode '--continue'")
    expect(plan?.sessionOptions).toEqual({ model: 'xai/grok-4.6' })
  })

  it('launches a Pi worker with a model and thinking level without persisting them', () => {
    const plan = buildAgentStartupPlan({
      agent: 'pi',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'google/gemini-3-pro', effort: 'xhigh' },
      sessionOptionsOverrideAgentArgs: true,
      agentArgs: '--continue'
    })
    expect(plan?.launchCommand).toBe(
      "pi '--continue' '--model' 'google/gemini-3-pro' '--thinking' 'xhigh'"
    )
    expect(plan?.launchConfig.agentCommand).toBe("pi '--continue'")
    expect(plan?.sessionOptions).toEqual({ model: 'google/gemini-3-pro', effort: 'xhigh' })
  })

  describe.each([
    { platform: 'linux', shell: 'posix' },
    { platform: 'win32', shell: 'powershell' },
    { platform: 'win32', shell: 'cmd' }
  ] as const)('Pi launch boundaries on $shell', ({ platform, shell }) => {
    const agentArgs = resolveTuiAgentLaunchArgs('pi', { pi: '--provider google' })
    const sessionOptions = { model: 'google/gemini-3-pro', effort: 'xhigh' }
    const args = {
      agent: 'pi' as const,
      cmdOverrides: {},
      platform,
      shell,
      agentArgs,
      sessionOptions
    }
    const optionTokens = [
      '--model',
      sessionOptions.model,
      '--thinking',
      'xhigh',
      '--provider',
      'google'
    ]
    const tokens = (command: string | undefined) => {
      const parsed = tokenizeStartupCommand(command ?? '', shell)
      expect(parsed.ok).toBe(true)
      return parsed.ok ? parsed.tokens : []
    }

    it.each([
      { agentArgs: '--', cmdOverrides: {}, prefix: ['pi', '--'] },
      { agentArgs: '"--"', cmdOverrides: {}, prefix: ['pi', '--'] },
      { agentArgs: '-- "--"', cmdOverrides: {}, prefix: ['pi', '--', '--'] },
      {
        agentArgs: '--provider google --',
        cmdOverrides: {},
        prefix: ['pi', '--provider', 'google', '--']
      },
      { agentArgs: '--offline --', cmdOverrides: {}, prefix: ['pi', '--offline', '--'] },
      { agentArgs: '', cmdOverrides: { pi: 'pi --' }, prefix: ['pi', '--'] },
      { agentArgs: '', cmdOverrides: { pi: 'pi "--"' }, prefix: ['pi', '--'] }
    ])('reuses an existing separator in $agentArgs / $cmdOverrides', (settings) => {
      for (const prompt of ['--help', '--version', '-...', '--', 'keep -- inside']) {
        const plan = buildAgentStartupPlan({ ...args, ...settings, sessionOptions: {}, prompt })
        expect(tokens(plan?.launchCommand)).toEqual([...settings.prefix, prompt])
        expect(plan?.launchConfig.agentArgs).toBe(settings.agentArgs)
        expect(tokens(plan?.launchConfig.agentCommand)).toEqual(settings.prefix)
        if (settings.cmdOverrides.pi) {
          expect(plan?.launchConfig.agentCommand).toBe(settings.cmdOverrides.pi)
          expect(plan?.launchCommand.startsWith(`${settings.cmdOverrides.pi} `)).toBe(true)
        }
      }
    })

    it('preserves a quoted executable override with an existing terminator byte-for-byte', () => {
      const override =
        shell === 'posix'
          ? '"/opt/Pi Tools/pi" --'
          : `${shell === 'powershell' ? '& ' : ''}"C:/Program Files/Pi/pi.cmd" --`
      const plan = buildAgentStartupPlan({
        ...args,
        agentArgs: '',
        sessionOptions: {},
        cmdOverrides: { pi: override },
        prompt: '--help'
      })
      expect(plan?.launchConfig.agentCommand).toBe(override)
      expect(plan?.launchCommand).toBe(`${override} ${shell === 'cmd' ? '"--help"' : "'--help'"}`)
    })

    it('inserts worker preferences before an existing argument terminator', () => {
      const plan = buildAgentStartupPlan({
        ...args,
        agentArgs: '--provider google --',
        sessionOptionsOverrideAgentArgs: true,
        prompt: '--help'
      })
      expect(tokens(plan?.launchCommand)).toEqual([
        'pi',
        '--provider',
        'google',
        '--model',
        sessionOptions.model,
        '--thinking',
        'xhigh',
        '--',
        '--help'
      ])
      expect(plan?.sessionOptions).toEqual(sessionOptions)
    })

    it.each(['Review & explain', '100% ready!', 'keep -- & explain'])(
      'keeps structured flag value %j independent of shell serialization',
      (value) => {
        const plan = buildAgentStartupPlan({
          ...args,
          sessionOptions: {},
          agentArgs: `--system-prompt "${value}" --`,
          prompt: 'ordinary prompt'
        })
        expect(tokens(plan?.launchCommand)).toEqual([
          'pi',
          '--system-prompt',
          value,
          '--',
          'ordinary prompt'
        ])
        expect(plan?.launchConfig.agentArgs).toBe(`--system-prompt "${value}" --`)
        if (shell === 'cmd' && value === 'Review & explain') {
          expect(plan?.launchCommand).toBe(
            'pi "--system-prompt" "Review ^& explain" "--" "ordinary prompt"'
          )
        }
      }
    )

    it('recognizes a flag value spanning the override and configured arguments', () => {
      const plan = buildAgentStartupPlan({
        ...args,
        sessionOptions: {},
        cmdOverrides: { pi: 'pi --system-prompt' },
        agentArgs: '"--"',
        prompt: 'ordinary prompt'
      })
      expect(tokens(plan?.launchCommand)).toEqual([
        'pi',
        '--system-prompt',
        '--',
        '--',
        'ordinary prompt'
      ])
    })

    it.each(['--system-prompt', '--append-system-prompt', '--model', '--name'])(
      'does not mistake the quoted value of %s for a terminator',
      (flag) => {
        for (const useOverride of [false, true]) {
          const plan = buildAgentStartupPlan({
            ...args,
            sessionOptions: {},
            agentArgs: useOverride ? '' : `${flag} "--"`,
            cmdOverrides: useOverride ? { pi: `pi ${flag} "--"` } : {},
            prompt: '--'
          })
          expect(tokens(plan?.launchCommand)).toEqual(['pi', flag, '--', '--', '--'])
        }
      }
    )

    it('keeps quoted text containing -- intact before the real terminator', () => {
      const plan = buildAgentStartupPlan({
        ...args,
        agentArgs: '--system-prompt "keep -- here" --',
        prompt: '--help'
      })
      expect(tokens(plan?.launchCommand)).toEqual([
        'pi',
        '--model',
        sessionOptions.model,
        '--thinking',
        'xhigh',
        '--system-prompt',
        'keep -- here',
        '--',
        '--help'
      ])
    })

    it('consumes each separator-shaped flag value before adding the prompt boundary', () => {
      const plan = buildAgentStartupPlan({
        ...args,
        sessionOptions: {},
        agentArgs: '--system-prompt "--" --append-system-prompt "--"',
        prompt: '--help'
      })
      expect(tokens(plan?.launchCommand)).toEqual([
        'pi',
        '--system-prompt',
        '--',
        '--append-system-prompt',
        '--',
        '--',
        '--help'
      ])
    })

    it.each([
      { agentArgs: '--provider google', sessionOptions: {} },
      { agentArgs: '', sessionOptions }
    ])('refuses options appended after an override terminator: %j', (settings) => {
      expect(
        buildAgentStartupPlan({
          ...args,
          ...settings,
          cmdOverrides: { pi: 'pi --' },
          prompt: '--help'
        })
      ).toBeNull()
    })

    it.each(['pi --extension-flag "--"', 'wrapper -- pi', 'pi; pi --'])(
      'refuses ambiguous separator ownership in %s',
      (override) => {
        expect(
          buildAgentStartupPlan({
            ...args,
            agentArgs: '',
            sessionOptions: {},
            cmdOverrides: { pi: override },
            prompt: '--help'
          })
        ).toBeNull()
      }
    )

    it.each(['--system-prompt "--"', '--system-prompt "--" --'])(
      'refuses worker option insertion that would split a flag value: %s',
      (agentArgs) => {
        expect(
          buildAgentStartupPlan({
            ...args,
            agentArgs,
            sessionOptionsOverrideAgentArgs: true,
            prompt: '--help'
          })
        ).toBeNull()
      }
    )

    it('keeps configured defaults and picker options before the prompt separator', () => {
      const plan = buildAgentStartupPlan({ ...args, prompt: '--help' })
      expect(tokens(plan?.launchCommand)).toEqual(['pi', ...optionTokens, '--', '--help'])
      expect(plan?.sessionOptions).toEqual(sessionOptions)
      expect(plan?.launchConfig.agentArgs).toBe(agentArgs)
      expect(tokens(plan?.launchConfig.agentCommand)).toEqual(['pi', '--provider', 'google'])

      const resume = buildAgentResumeStartupPlan({
        ...args,
        agentCommand: plan?.launchConfig.agentCommand,
        providerSession: {
          key: 'session_id',
          id: 'session-1',
          transcriptPath: 'session with spaces.jsonl'
        }
      })
      expect(tokens(resume?.launchCommand)).toEqual([
        'pi',
        '--provider',
        'google',
        '--session',
        'session with spaces.jsonl'
      ])
      expect(resume?.sessionOptions).toBeUndefined()
      expect(resume?.followupPrompt).toBeNull()
    })

    it('keeps worker overrides before the separator without persisting them', () => {
      const plan = buildAgentStartupPlan({
        ...args,
        agentArgs: '--model old-model --thinking low --provider google',
        sessionOptionsOverrideAgentArgs: true,
        prompt: '--version'
      })
      expect(tokens(plan?.launchCommand)).toEqual([
        'pi',
        '--provider',
        'google',
        '--model',
        sessionOptions.model,
        '--thinking',
        'xhigh',
        '--',
        '--version'
      ])
      expect(tokens(plan?.launchConfig.agentCommand)).toEqual([
        'pi',
        '--model',
        'old-model',
        '--thinking',
        'low',
        '--provider',
        'google'
      ])
    })

    it('does not add a separator or model to built-in defaults or empty launches', () => {
      expect(resolveTuiAgentLaunchArgs('pi', null)).toBe('')
      expect(buildAgentStartupPlan({ ...args, prompt: '  ' })).toBeNull()
      const plan = buildAgentStartupPlan({ ...args, prompt: '  ', allowEmptyPromptLaunch: true })
      expect(tokens(plan?.launchCommand)).toEqual(['pi', ...optionTokens])
    })

    it('keeps flag-shaped drafts in prefill env rather than submitting them as argv', () => {
      const draft = '--help\n--version\n-...'
      const agentEnv = { ORCA_AGENT_MODE: 'managed' }
      const plan = buildAgentDraftLaunchPlan({ ...args, draft, agentEnv })
      const empty = buildAgentStartupPlan({ ...args, prompt: '', allowEmptyPromptLaunch: true })
      expect(
        plan?.launchCommand.startsWith(`${empty?.launchCommand}${shell === 'cmd' ? ' & ' : '; '}`)
      ).toBe(true)
      expect(plan?.launchCommand).not.toContain('--help')
      expect(plan?.env).toEqual({ ...agentEnv, ORCA_PI_PREFILL: draft })
      expect(plan?.sessionOptions).toEqual(sessionOptions)
      expect(plan?.launchConfig).toEqual({ ...empty?.launchConfig, agentEnv })
    })
  })

  it.each([
    'env PI_CODING_AGENT_DIR=/tmp/pi pi',
    'PI_CODING_AGENT_DIR=/tmp/pi pi',
    '/usr/bin/env PI_CODING_AGENT_DIR="/tmp/pi home" pi'
  ])('preserves the transparent POSIX prefix %s', (override) => {
    for (const isRemote of [false, true]) {
      for (const separatorInOverride of [false, true]) {
        const command = `${override}${separatorInOverride ? ' --' : ''}`
        const agentArgs = separatorInOverride ? '' : '--provider google --'
        const plan = buildAgentStartupPlan({
          agent: 'pi',
          platform: 'linux',
          shell: 'posix',
          cmdOverrides: { pi: command },
          agentArgs,
          prompt: 'ordinary prompt',
          isRemote
        })
        const base = separatorInOverride ? command : `${command} '--provider' 'google' '--'`
        expect(plan?.launchCommand).toBe(`${base} 'ordinary prompt'`)
        expect(plan?.launchConfig).toEqual({ agentCommand: base, agentArgs, agentEnv: {} })
      }
    }
  })

  it('inserts worker preferences before an argument terminator', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'custom-codex-model', effort: 'high' },
      sessionOptionsOverrideAgentArgs: true,
      agentArgs: '--dangerously-bypass-approvals-and-sandbox -- literal'
    })
    expect(plan?.launchCommand).toBe(
      "codex '--dangerously-bypass-approvals-and-sandbox' '-m' 'custom-codex-model' '-c' 'model_reasoning_effort=high' '--' 'literal'"
    )
  })

  it('rejects conflicting singleton flags in an agent command override', () => {
    expect(
      resolveAgentLaunchCommand({
        agent: 'codex',
        cmdOverrides: { codex: 'codex --profile work -m gpt-5.5' },
        platform: 'linux',
        shell: 'posix',
        sessionOptions: { model: 'custom-codex-model', effort: 'high' },
        sessionOptionsOverrideAgentArgs: true
      })
    ).toEqual({
      ok: false,
      error:
        'Agent command override conflicts with the requested launch preferences. Remove model or effort flags from the command override.'
    })
  })

  it('recognizes a long Codex model flag overriding the generated short flag', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'gpt-5.6-sol', effort: 'medium' },
      agentArgs: '--model gpt-5.5'
    })
    expect(plan?.sessionOptions).toBeUndefined()
  })

  it('keeps one-time picker flags out of the command captured for resume', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'gpt-5.6-sol', effort: 'medium' },
      agentArgs: '--dangerously-bypass-approvals-and-sandbox'
    })
    expect(plan?.launchConfig.agentCommand).toBe(
      "codex '--dangerously-bypass-approvals-and-sandbox'"
    )
  })

  it('quotes option values for a remote POSIX launch', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      isRemote: true,
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: "team's-model", effort: 'high' }
    })
    expect(plan?.launchCommand).toContain(`'team'"'"'s-model'`)
  })

  it('threads options through native draft launches', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'claude',
      draft: 'review this',
      cmdOverrides: {},
      platform: 'linux',
      sessionOptions: { model: 'opus', effort: 'high' }
    })
    expect(plan?.launchCommand).toContain("claude '--model' 'opus' '--effort' 'high'")
    expect(plan?.sessionOptions).toEqual({ model: 'opus', effort: 'high' })
  })

  it('applies explicit session options to resume commands', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'thread-1' },
      cmdOverrides: {},
      platform: 'linux',
      agentArgs: '-m gpt-5.6-sol -c model_reasoning_effort=medium',
      sessionOptions: { model: 'gpt-5.5', effort: 'high' },
      sessionOptionsOverrideAgentArgs: true
    })
    expect(plan?.launchCommand).toBe(
      "codex '-m' 'gpt-5.5' '-c' 'model_reasoning_effort=high' 'resume' 'thread-1'"
    )
    expect(plan?.launchConfig.agentCommand).toBe(
      "codex '-m' 'gpt-5.6-sol' '-c' 'model_reasoning_effort=medium'"
    )
    expect(plan?.sessionOptions).toEqual({ model: 'gpt-5.5', effort: 'high' })
  })
})
