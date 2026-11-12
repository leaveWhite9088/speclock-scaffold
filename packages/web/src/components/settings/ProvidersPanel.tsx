import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirm';
import { DialogActions } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { IconButton } from '@/components/ui/icon-button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { ModelPicker } from './ModelPicker';
import { useProviders } from '@/hooks/queries';
import { api, enc } from '@/lib/api';
import { parseSize, sizeText, slug } from '@/lib/format';
import type { Provider, ProviderCli, ProviderTest } from '@/lib/types';

interface Draft {
  id: string;
  name: string;
  apiKey: string;
  anthropic: string;
  openai: string;
  models: string;
  /** model -> context length as typed ("1M") */
  contexts: Record<string, string>;
  /** the models that reason */
  reasonings: string[];
  types: string[];
}

/** A new provider starts with the CLIs that take it per process ticked; one that changes the CLI's own configuration (mcode) is for the person to tick. */
const emptyDraft = (clis: ProviderCli[]): Draft => ({ id: '', name: '', apiKey: '', anthropic: '', openai: '', models: '', contexts: {}, reasonings: [], types: clis.filter((c) => c.scope === 'process').map((c) => c.type) });

const draftOf = (p: Provider): Draft => ({ id: p.id, name: p.name, apiKey: '', anthropic: p.endpoints.anthropic ?? '', openai: p.endpoints.openai ?? '', models: p.models.join(', '), contexts: Object.fromEntries(Object.entries(p.contexts ?? {}).map(([m, n]) => [m, sizeText(n)])), reasonings: p.reasonings ?? [], types: p.types });

type Result = ProviderTest | { error: string };

/**
 * Providers: an endpoint and a key typed once, kept on this device. "测试" asks every CLI the provider is enabled for to
 * answer one word through it, and the row shows how many did.
 */
export function ProvidersPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isPending } = useProviders();
  const providers = data?.providers ?? [];
  const clis = data?.clis ?? [];
  const [edit, setEdit] = useState<{ d: Draft; isNew: boolean } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const set = (patch: Partial<Draft>) => setEdit((e) => (e ? { ...e, d: { ...e.d, ...patch } } : e));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const { d } = edit;
    try {
      await api('POST', '/api/providers', {
        id: edit.isNew ? slug(d.name, providers.map((p) => p.id), 'provider') : d.id,
        name: d.name.trim(),
        apiKey: d.apiKey.trim(),
        endpoints: { anthropic: d.anthropic.trim(), openai: d.openai.trim() },
        models: d.models,
        contexts: Object.fromEntries(Object.entries(d.contexts).map(([m, t]): [string, number] => [m, parseSize(t)]).filter(([, n]) => n > 0)),
        reasonings: d.reasonings,
        types: d.types,
      });
      setEdit(null);
      setResults((r) => {
        const { [d.id]: _old, ...rest } = r;
        return rest;
      });
      await qc.invalidateQueries({ queryKey: ['providers'] });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const remove = async (p: Provider) => {
    if (!(await confirm({ title: `删除供应商「${p.name}」？`, confirmText: '删除', danger: true }))) return;
    try {
      await api('DELETE', `/api/providers/${enc(p.id)}`);
      await qc.invalidateQueries({ queryKey: ['providers'] });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  /** Test the CLIs it is enabled for, or only `type`; a one-CLI result replaces that CLI's line and keeps the others. */
  const test = async (p: Provider, type?: string) => {
    setTesting(`${p.id}${type ? `:${type}` : ''}`);
    setOpen((s) => new Set(s).add(p.id)); // the lines being tested are where the feedback is
    try {
      const r = await api<ProviderTest>('POST', `/api/providers/${enc(p.id)}/test`, type ? { types: [type] } : {});
      const good = r.results.filter((x) => x.ok).length;
      toast(`${p.name}：${good}/${r.results.length} 能用`);
      setResults((x) => {
        const old = x[p.id];
        if (!type || !old || 'error' in old) return { ...x, [p.id]: r };
        return { ...x, [p.id]: { ...r, endpoints: { ...old.endpoints, ...r.endpoints }, results: [...old.results.filter((o) => o.type !== type), ...r.results] } };
      });
    } catch (err) {
      setResults((x) => ({ ...x, [p.id]: { error: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  };

  if (edit) {
    const label = 'grid-cols-[5.5em_minmax(0,1fr)]';
    const valid = edit.d.name.trim() && edit.d.models.trim() && (edit.d.openai.trim() || edit.d.anthropic.trim()) && (!edit.isNew || edit.d.apiKey.trim());
    return (
      <form onSubmit={submit} className="grid gap-2.5">
        <Field label="名称" className={label}>
          <Input required autoFocus value={edit.d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Key" className={label}>
          <Input required={edit.isNew} type="password" autoComplete="off" placeholder={edit.isNew ? '' : '不改就留空'} value={edit.d.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
        </Field>
        <Field label="OpenAI" className={label}>
          <Input placeholder="https://…/v1" value={edit.d.openai} onChange={(e) => set({ openai: e.target.value })} />
        </Field>
        <Field label="Anthropic" className={label}>
          <Input placeholder="https://…/anthropic" value={edit.d.anthropic} onChange={(e) => set({ anthropic: e.target.value })} />
        </Field>
        <ModelPicker id={edit.isNew ? undefined : edit.d.id} apiKey={edit.d.apiKey} openai={edit.d.openai} anthropic={edit.d.anthropic} value={edit.d.models} onChange={(models) => set({ models })} contexts={edit.d.contexts} onContexts={(contexts) => set({ contexts })} reasonings={edit.d.reasonings} onReasonings={(reasonings) => set({ reasonings })} />
        <div className="grid grid-cols-[5.5em_minmax(0,1fr)] items-start gap-x-2 text-[12.5px] text-muted">
          <span className="pt-0.5">CLI</span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-ink">
            {clis.map((c) => (
              <Checkbox key={c.type} checked={edit.d.types.includes(c.type)} onChange={(on) => set({ types: on ? [...edit.d.types, c.type] : edit.d.types.filter((t) => t !== c.type) })} title={c.scope === 'global' ? '会写入它自己的全局配置：测试时临时加、测完删；执行者暂不能用' : undefined}>
                {c.label}
              </Checkbox>
            ))}
          </div>
        </div>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>取消</Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            保存
          </Button>
        </DialogActions>
      </form>
    );
  }

  return (
    <div className="grid gap-3">
      <ul className="m-0 grid list-none gap-2 p-0">
        {providers.map((p) => (
          <ProviderRow key={p.id} p={p} expanded={open.has(p.id)} onToggle={() => toggle(p.id)} testing={testing} result={results[p.id]} onTest={(type) => void test(p, type)} onEdit={() => setEdit({ d: draftOf(p), isNew: false })} onRemove={() => void remove(p)} />
        ))}
        {!providers.length ? <Empty>{isPending ? '读取中…' : '还没有供应商'}</Empty> : null}
      </ul>
      <div>
        <Button size="sm" onClick={() => setEdit({ d: emptyDraft(clis), isNew: true })}>
          ＋ 添加供应商
        </Button>
      </div>
    </div>
  );
}

function ProviderRow({ p, expanded, onToggle, testing, result, onTest, onEdit, onRemove }: { p: Provider; expanded: boolean; onToggle: () => void; testing: string | null; result?: Result; onTest: (type?: string) => void; onEdit: () => void; onRemove: () => void }) {
  const tested = result && 'results' in result ? result : null;
  const byType = new Map(tested?.results.map((r) => [r.type, r]));
  const usable = p.support.filter((s) => s.enabled && s.supported);
  const ok = usable.filter((s) => byType.get(s.type)?.ok).length;
  const ran = usable.filter((s) => byType.has(s.type)).length;
  const busy = testing !== null;
  return (
    <li className="card">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={expanded}>
          <ChevronRight className={`size-3.5 shrink-0 text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <span className="truncate text-[13px] font-semibold">{p.name}</span>
          <span className="truncate text-[12.5px] text-muted">{p.models.join(', ')}</span>
        </button>
        {ran > 0 ? (
          ok === usable.length ? (
            <span className="inline-flex items-center gap-0.5 text-[12px] text-ok" title="已启用的 CLI 都能用">
              <Check className="size-3.5" />
              {ok}
            </span>
          ) : (
            <span className="text-[12px] text-danger" title="有 CLI 没通过，展开看原因">
              {ok}/{usable.length}
            </span>
          )
        ) : null}
        <Button size="none" className="h-6 px-2 text-[12px]" disabled={busy || !p.types.length} onClick={() => onTest()}>
          {testing === p.id ? <Spinner /> : null}
          {testing === p.id ? '测试中' : '测试'}
        </Button>
        <IconButton label="编辑" onClick={onEdit}>
          <Pencil />
        </IconButton>
        <IconButton label="删除" className="hover:text-danger" onClick={onRemove}>
          <Trash2 />
        </IconButton>
      </div>
      {result && 'error' in result ? <div className="px-3 pb-2 text-[12.5px] text-danger">{result.error}</div> : null}
      {expanded ? (
        <ul className="m-0 grid list-none gap-1 border-t border-line px-3 py-2 text-[12.5px]">
          {p.support.map((s) => {
            const running = s.enabled && s.supported && (testing === p.id || testing === `${p.id}:${s.type}`);
            const r = running ? undefined : byType.get(s.type);
            const state = running ? 'run' : !s.enabled || !s.supported ? 'off' : !r ? 'idle' : r.ok ? 'ok' : r.skipped ? 'off' : 'bad';
            const tone = { off: 'text-muted', idle: 'text-muted', run: 'text-ink', ok: 'text-ink', bad: 'text-danger' }[state];
            const note = running ? '测试中…' : !s.enabled ? '未启用' : !s.supported ? (s.reason ?? '不支持') : !r ? '' : r.ok ? `${(r.ms / 1000).toFixed(0)}s` : r.detail;
            return (
              <li key={s.type} className={`grid grid-cols-[1.2em_9.5em_minmax(0,1fr)_auto] items-baseline gap-x-2 ${tone}`}>
                <span className="flex justify-center">{state === 'run' ? <Spinner className="translate-y-0.5" /> : state === 'ok' ? <Check className="size-3.5 translate-y-0.5 text-ok" /> : state === 'bad' ? '✗' : '–'}</span>
                <span>{s.label}</span>
                <span className="min-w-0 wrap-anywhere">{note}</span>
                <button type="button" className="text-accent disabled:invisible" disabled={busy || !s.enabled || !s.supported} onClick={() => onTest(s.type)}>
                  测试
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
