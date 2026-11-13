import { Field } from '@/components/ui/field';
import { Select, type SelectOption } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
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
  /** The reasoning level: shown when the CLI has levels to pick from (more than the default). */
  effort?: { value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean; /** The list was opened: where the levels are only asked for then, this starts it (and the field shows even with one option). */ onOpen?: () => void };
}

/**
 * Where an agent runs and with which model, the same for a dispatcher and an executor: the provider first (or the CLI's own
 * login), then the model, which is that provider's list or the CLI's own.
 */
export function RuntimeFields({ type, providerId, providerModel, onProvider, onProviderModel, base, effort }: Props) {
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
      {effort && (effort.options.length > 1 || effort.onOpen) ? (
        <Field label="推理强度">
          <div className="relative">
            <Select value={effort.value} onChange={effort.onChange} disabled={effort.disabled} options={effort.options} onOpenChange={(o) => o && effort.onOpen?.()} />
            {/* disabled is only set while the levels are being asked for */}
            {effort.disabled ? <Spinner className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 text-muted" /> : null}
          </div>
        </Field>
      ) : null}
    </>
  );
}
