import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';

interface Props {
  /** The saved provider this edits, whose stored key is used while the form's key is empty. */
  id?: string;
  apiKey: string;
  openai: string;
  anthropic: string;
  /** The chosen models, as the text the provider is saved with (comma separated). */
  value: string;
  onChange: (value: string) => void;
}

const ids = (text: string) => [...new Set(text.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean))];

/**
 * The models of a provider, found by asking its endpoint (once the key and an address are filled in) instead of typed in.
 * The person ticks the ones to keep; when the endpoint has no listing, they can be typed.
 */
export function ModelPicker({ id, apiKey, openai, anthropic, value, onChange }: Props) {
  const [found, setFound] = useState<string[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const chosen = ids(value);
  const seq = useRef(0);
  const ready = (apiKey.trim() || id) && (openai.trim() || anthropic.trim());

  const discover = async () => {
    const mine = ++seq.current;
    setFinding(true);
    setError('');
    try {
      const r = await api<{ models: string[]; errors: Record<string, string> }>('POST', '/api/providers/discover', { id, apiKey: apiKey.trim(), endpoints: { openai: openai.trim(), anthropic: anthropic.trim() } });
      if (mine !== seq.current) return;
      setFound(r.models);
      if (!r.models.length) setError(Object.values(r.errors)[0] ?? '没有找到模型');
      // a short list is taken whole when nothing was chosen yet
      else if (!chosen.length && r.models.length <= 12) onChange(r.models.join(', '));
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setFinding(false);
    }
  };

  // Ask again a moment after the key or an address stops changing.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void discover(), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, openai, anthropic, id]);

  const list = [...new Set([...(found ?? []), ...chosen])];
  const shown = list.filter((m) => m.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (m: string, on: boolean) => onChange((on ? [...chosen, m] : chosen.filter((x) => x !== m)).join(', '));

  if (!list.length) {
    return (
      <Field label="模型">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Input required className="min-w-0 flex-1" placeholder={finding ? '正在获取…' : ready ? '' : '填好 Key 和地址后自动获取'} value={value} onChange={(e) => onChange(e.target.value)} />
            {finding ? <Spinner /> : ready ? (
              <IconButton label="重新获取" onClick={() => void discover()}>
                <RefreshCw />
              </IconButton>
            ) : null}
          </div>
          {error ? <span className="text-[12.5px] text-danger">{error}，可以手动填写（逗号分隔）</span> : null}
        </div>
      </Field>
    );
  }

  return (
    <Field label="模型" className="items-start">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Input className="min-w-0 flex-1" placeholder={`搜索 ${list.length} 个，已选 ${chosen.length}`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {finding ? (
            <Spinner />
          ) : (
            <IconButton label="重新获取" onClick={() => void discover()}>
              <RefreshCw />
            </IconButton>
          )}
        </div>
        <div className="grid max-h-44 gap-1.5 overflow-y-auto rounded-md border border-line-2 bg-raised px-2.5 py-2">
          {shown.map((m) => (
            <Checkbox key={m} checked={chosen.includes(m)} onChange={(on) => toggle(m, on)}>
              <span className="truncate">{m}</span>
            </Checkbox>
          ))}
          {!shown.length ? <span className="text-[12.5px] text-muted">没有匹配的</span> : null}
        </div>
        {error ? <span className="text-[12.5px] text-danger">{error}</span> : null}
      </div>
    </Field>
  );
}
