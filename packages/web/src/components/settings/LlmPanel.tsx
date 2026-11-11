import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CardRow } from '@/components/ui/card-row';
import { useConfirm } from '@/components/ui/confirm';
import { DialogActions } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useLlms } from '@/hooks/queries';
import { api, enc } from '@/lib/api';
import { slug } from '@/lib/format';
import type { Llm } from '@/lib/types';

interface Form {
  /** The provider's key in models.json; empty while adding (made from the name). */
  provider: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  isNew: boolean;
  /** The models it had, so the ones left out of the list can be removed. */
  had: string[];
}

const EMPTY: Form = { provider: '', name: '', baseUrl: '', apiKey: '', models: '', isNew: true, had: [] };
const ids = (text: string) => [...new Set(text.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean))];

/** The models of the dispatchers (pi): shared by every project. A change restarts the dispatchers that are running. */
export function LlmPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: llms, isPending } = useLlms();
  const [form, setForm] = useState<Form | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['llms'] });
    await qc.invalidateQueries({ queryKey: ['dispatcher-models'] });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const now = ids(form.models);
    try {
      const provider = form.isNew ? slug(form.name, llms?.map((l) => l.provider), 'llm') : form.provider;
      await api('POST', '/api/dispatcher/llms', {
        provider,
        baseUrl: form.baseUrl.trim(),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        models: now.map((id) => ({ id })),
      });
      const dropped = form.had.filter((id) => !now.includes(id));
      if (dropped.length) await api('DELETE', `/api/dispatcher/llms/${enc(provider)}?models=${dropped.map(enc).join(',')}`);
      setResults((x) => {
        const { [provider]: _old, ...rest } = x;
        return rest;
      });
      setForm(null);
      await refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  /** One small request to the model's own address with its key. */
  const test = async (provider: string) => {
    setTesting(provider);
    try {
      const r = await api<{ ok: boolean; detail: string }>('POST', `/api/dispatcher/llms/${enc(provider)}/test`);
      setResults((x) => ({ ...x, [provider]: r }));
      toast(r.ok ? `${provider}：能用` : `${provider}：${r.detail}`);
    } catch (err) {
      setResults((x) => ({ ...x, [provider]: { ok: false, detail: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  };

  const remove = async (provider: string) => {
    if (!(await confirm({ title: `删除「${provider}」？`, confirmText: '删除', danger: true }))) return;
    try {
      await api('DELETE', `/api/dispatcher/llms/${enc(provider)}`);
      await refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const edit = (l: Llm): Form => ({ provider: l.provider, name: l.provider, baseUrl: l.baseUrl, apiKey: '', models: l.models.map((m) => m.id).join(', '), isNew: false, had: l.models.map((m) => m.id) });

  if (form) {
    const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
    const valid = form.name.trim() && form.baseUrl.trim() && ids(form.models).length && (!form.isNew || form.apiKey.trim());
    return (
      <form onSubmit={submit} className="grid gap-2.5">
        <Field label="名称">
          <Input required autoFocus={form.isNew} disabled={!form.isNew} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="地址">
          <Input required placeholder="https://…/v1" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
        </Field>
        <Field label="Key">
          <Input required={form.isNew} type="password" autoComplete="off" placeholder={form.isNew ? '' : '不改就留空'} value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
        </Field>
        <Field label="模型">
          <Input required autoFocus={!form.isNew} placeholder="多个用逗号分隔" value={form.models} onChange={(e) => set({ models: e.target.value })} />
        </Field>
        <DialogActions>
          <Button onClick={() => setForm(null)}>取消</Button>
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
        {llms?.map((l) => (
          <CardRow
            key={l.provider}
            title={l.provider}
            sub={results[l.provider] && !results[l.provider].ok ? <span className="text-danger">{results[l.provider].detail}</span> : l.models.map((m) => m.id).join(', ')}
            actions={
              <>
                {results[l.provider]?.ok ? <Check className="size-3.5 text-ok" aria-label="可用" /> : null}
                <Button size="none" className="h-6 px-2 text-[12px]" disabled={testing !== null} onClick={() => void test(l.provider)}>
                  {testing === l.provider ? <Spinner /> : null}
                  {testing === l.provider ? '测试中' : '测试'}
                </Button>
                <IconButton label="编辑" onClick={() => setForm(edit(l))}>
                  <Pencil />
                </IconButton>
                <IconButton label="删除" className="hover:text-danger" onClick={() => void remove(l.provider)}>
                  <Trash2 />
                </IconButton>
              </>
            }
          />
        ))}
        {!llms?.length ? <Empty>{isPending ? '读取中…' : '还没有模型'}</Empty> : null}
      </ul>
      <div>
        <Button size="sm" onClick={() => setForm(EMPTY)}>
          ＋ 添加模型
        </Button>
      </div>
    </div>
  );
}
