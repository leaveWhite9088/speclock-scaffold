import { Field } from '@/components/ui/field';
import { Select, type SelectOption } from '@/components/ui/select';
import { useProviders } from '@/hooks/queries';

/** The providers kept on this device that `type` (a CLI, or pi for a dispatcher) may start with. */
export function useUsableProviders(type: string) {
  const providers = useProviders().data?.providers ?? [];
  return providers.filter((p) => p.support.some((s) => s.type === type && s.supported && s.enabled && s.scope === 'process'));
}

interface Props {
  /** The CLI it runs on (`pi` for a dispatcher). */
  type: string;
  providerId: string;
  /** The model while a provider is chosen. */
  providerModel: string;
  onProvider: (id: string, model: string) => void;
  onProviderModel: (model: string) => void;
  /** The model while no provider is chosen: the CLI's own list. */
  base: { value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean };
}

/**
 * Where an agent runs and with which model, the same for a dispatcher and an executor: the provider first (or the CLI's own
 * login), then the model, which is that provider's list or the CLI's own.
 */
export function RuntimeFields({ type, providerId, providerModel, onProvider, onProviderModel, base }: Props) {
  const usable = useUsableProviders(type);
  const chosen = usable.find((p) => p.id === providerId);
  const modelOptions = chosen
    ? [...new Set([...chosen.models, ...(providerModel && !chosen.models.includes(providerModel) ? [providerModel] : [])])].map((m) => ({ value: m, label: m }))
    : base.options;
  return (
    <>
      <Field label="供应商">
        <Select
          value={providerId}
          onChange={(id) => onProvider(id, usable.find((p) => p.id === id)?.models[0] ?? '')}
          options={[{ value: '', label: '自带登录' }, ...usable.map((p) => ({ value: p.id, label: p.name })), ...(providerId && !chosen ? [{ value: providerId, label: `${providerId}（不可用）` }] : [])]}
        />
      </Field>
      <Field label="模型">
        {chosen ? <Select value={providerModel} onChange={onProviderModel} options={modelOptions} /> : <Select value={base.value} onChange={base.onChange} disabled={base.disabled} options={base.options} />}
      </Field>
    </>
  );
}
