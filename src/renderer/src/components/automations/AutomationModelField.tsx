import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { automationSupportsLaunchModel } from '../../../../shared/automation-launch-preferences'
import { AUTOMATION_EDITOR_SECTION_LABEL_CLASS, Field } from './automation-page-parts'
import type { AutomationDraft } from './AutomationEditorDialog'

type AutomationModelFieldProps = {
  draft: AutomationDraft
  pickerTriggerClassName: string
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}

export function AutomationModelField({
  draft,
  pickerTriggerClassName,
  onDraftChange
}: AutomationModelFieldProps): React.JSX.Element | null {
  if (!automationSupportsLaunchModel(draft.agentId)) {
    return null
  }
  return (
    <Field
      labelClassName={AUTOMATION_EDITOR_SECTION_LABEL_CLASS}
      label={translate('auto.components.automations.AutomationModelField.model', 'Model')}
    >
      <Input
        value={draft.model ?? ''}
        placeholder={translate(
          'auto.components.automations.AutomationModelField.placeholder',
          'Agent default'
        )}
        aria-label={translate('auto.components.automations.AutomationModelField.model', 'Model')}
        className={`h-9 ${pickerTriggerClassName}`}
        onChange={(event) =>
          onDraftChange((current) => ({ ...current, model: event.target.value }))
        }
      />
    </Field>
  )
}
