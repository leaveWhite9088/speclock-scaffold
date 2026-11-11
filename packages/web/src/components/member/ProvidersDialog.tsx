import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useProviders } from '@/hooks/queries';
import { api, enc } from '@/lib/api';
import type { Provider, ProviderTest } from '@/lib/types';

interface Draft {
  id: string;
  name: string;
  apiKey: string;
  anthropic: string;
  openai: string;
  models: string;
}

const EMPTY: Draft = { id: '', name: '', apiKey: '', anthropic: '', openai: '', models: '' };

const draftOf = (p: Provider): Draft => ({ id: p.id, name: p.name, apiKey: '', anthropic: p.endpoints.anthropic ?? '', openai: p.endpoints.openai ?? '', models: p.models.join(', ') });

/**
 * Providers: an endpoint and a key typed once, kept on this device. "测试连通" starts every CLI that can take the provider
 * and asks it for one word through it, so the list shows which CLIs really work with it.
 */
export function ProvidersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: providers = [], isPending } = useProviders(open);
  const [edit, setEdit] = useState<{ d: Draft; isNew: boolean } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProviderTest | { error: string }>>({});
  const set = (patch: Partial<Draft>) => setEdit((e) => (e ? { ...e, d: { ...e.d, ...patch } } : e));

  const close = (o: boolean) => {
    if (!o) setEdit(null);
    onOpenChange(o);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const { d } = edit;
    try {
      await api('POST', '/api/providers', {
        id: d.id.trim(),
        name: d.name.trim() || d.id.trim(),
        apiKey: d.apiKey.trim(),
        endpoints: { anthropic: d.anthropic.trim(), openai: d.openai.trim() },
        models: d.models,
      });
      toast('已保存');
      setEdit(null);
      setResults((r) => {
        const { [d.id.trim()]: _old, ...rest } = r;
        return rest;
      });
      await qc.invalidateQueries({ queryKey: ['providers'] });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const remove = async (p: Provider) => {
    const ok = await confirm({ title: `删除供应商「${p.name}」？`, description: '只删除这里保存的 Key 和地址，不影响各 CLI 自己的配置。', confirmText: '删除', danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/api/providers/${enc(p.id)}`);
      await qc.invalidateQueries({ queryKey: ['providers'] });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const test = async (p: Provider) => {
    setTesting(p.id);
    try {
      const r = await api<ProviderTest>('POST', `/api/providers/${enc(p.id)}/test`, {});
      setResults((x) => ({ ...x, [p.id]: r }));
    } catch (err) {
      setResults((x) => ({ ...x, [p.id]: { error: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="w-[min(680px,94vw)]"
        title={edit ? (edit.isNew ? '添加供应商' : `编辑供应商「${edit.d.name}」`) : '供应商'}
        description={
          edit
            ? 'Key 只保存在这台电脑上（data/state/providers.json），保存后不会再显示。不同 CLI 说的协议不一样：Claude Code 用 Anthropic 地址，其余用 OpenAI 兼容地址，两个都填就都能测。'
            : '填一次 Key 和地址，点「测试连通」，会逐个启动能用它的 CLI，看哪些真的能通过它回答。通过后，到执行者的设置里选它。'
        }
      >
        {edit ? (
          <form onSubmit={submit} className="grid gap-2">
            <Field label="标识">
              <Input required disabled={!edit.isNew} autoFocus={edit.isNew} placeholder="例如 minimax，小写字母数字和 -" value={edit.d.id} onChange={(e) => set({ id: e.target.value.toLowerCase(), name: edit.d.name && edit.d.name !== edit.d.id ? edit.d.name : e.target.value.toLowerCase() })} />
            </Field>
            <Field label="名称">
              <Input value={edit.d.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Key" hint={edit.isNew ? undefined : '留空保持原来的 Key'}>
              <Input required={edit.isNew} type="password" autoComplete="off" placeholder={edit.isNew ? 'sk-…' : '••••••••'} value={edit.d.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
            </Field>
            <Field label="OpenAI 兼容地址" hint="OpenCode、DeepSeek Harness、Codex、pi 用；Codex 需要它支持 /responses">
              <Input placeholder="例如 https://api.example.com/v1" value={edit.d.openai} onChange={(e) => set({ openai: e.target.value })} />
            </Field>
            <Field label="Anthropic 兼容地址" hint="Claude Code、MiniMax Code 用">
              <Input placeholder="例如 https://api.example.com/anthropic" value={edit.d.anthropic} onChange={(e) => set({ anthropic: e.target.value })} />
            </Field>
            <Field label="模型 id" hint="用逗号分隔，第一个用来测试">
              <Input required placeholder="例如 MiniMax-M2.7" value={edit.d.models} onChange={(e) => set({ models: e.target.value })} />
            </Field>
            <div className="mt-1.5 flex justify-end gap-2">
              <Button onClick={() => setEdit(null)}>返回</Button>
              <Button type="submit" variant="primary" disabled={!edit.d.id.trim() || !edit.d.models.trim() || (!edit.d.openai.trim() && !edit.d.anthropic.trim()) || (edit.isNew && !edit.d.apiKey.trim())}>
                保存
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-2">
            <ul className="m-0 grid max-h-[56vh] list-none gap-2 overflow-y-auto p-0">
              {providers.map((p) => (
                <ProviderRow key={p.id} p={p} testing={testing === p.id} busy={testing !== null} result={results[p.id]} onTest={() => void test(p)} onEdit={() => setEdit({ d: draftOf(p), isNew: false })} onRemove={() => void remove(p)} />
              ))}
              {!providers.length ? <li className="py-3 text-[12.5px] text-muted">{isPending ? '读取中…' : '还没有供应商。'}</li> : null}
            </ul>
            <div className="mt-1.5 flex justify-between">
              <Button variant="link" onClick={() => setEdit({ d: EMPTY, isNew: true })}>
                ＋ 添加供应商
              </Button>
              <Button onClick={() => close(false)}>关闭</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({ p, testing, busy, result, onTest, onEdit, onRemove }: { p: Provider; testing: boolean; busy: boolean; result?: ProviderTest | { error: string }; onTest: () => void; onEdit: () => void; onRemove: () => void }) {
  const tested = result && 'results' in result ? result : null;
  const byType = new Map(tested?.results.map((r) => [r.type, r]));
  return (
    <li className="grid gap-2 rounded-md border border-line px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">
            {p.name} <span className="font-normal text-muted">· Key {p.keyHint}</span>
          </div>
          <div className="truncate text-[12.5px] text-muted" title={p.models.join(', ')}>
            {p.models.join(', ')}
            {p.usedBy.length ? ` · ${p.usedBy.length} 个执行者在用` : ''}
          </div>
        </div>
        <Button variant="primary" disabled={busy} onClick={onTest}>
          {testing ? '测试中…' : '测试连通'}
        </Button>
        <Button variant="link" onClick={onEdit}>
          编辑
        </Button>
        <Button variant="linkDanger" onClick={onRemove}>
          删除
        </Button>
      </div>
      {testing ? <div className="text-[12.5px] text-muted">先试地址，再逐个启动 CLI，一般要半分钟到两分钟。</div> : null}
      {result && 'error' in result ? <div className="text-[12.5px] text-danger">测试没有完成：{result.error}</div> : null}
      {tested ? (
        <div className="grid gap-0.5 text-[12.5px]">
          {Object.entries(tested.endpoints).map(([proto, e]) => (
            <div key={proto} className={e.ok ? 'text-muted' : 'text-danger'}>
              {e.ok ? '✓' : '✗'} {proto === 'anthropic' ? 'Anthropic 地址' : 'OpenAI 地址'}：{e.ok ? `可用（${(e.ms / 1000).toFixed(1)}s）` : e.detail}
            </div>
          ))}
        </div>
      ) : null}
      <ul className="m-0 grid list-none gap-0.5 p-0 text-[12.5px]">
        {p.support.map((s) => {
          const r = byType.get(s.type);
          const mark = r ? (r.ok ? '✓' : r.skipped ? '–' : '✗') : s.supported ? '·' : '–';
          const tone = r ? (r.ok ? 'text-ink' : r.skipped ? 'text-muted' : 'text-danger') : 'text-muted';
          const note = r ? (r.ok ? `能用（${(r.ms / 1000).toFixed(0)}s）` : r.detail) : s.supported ? '没测过' : (s.reason ?? '不支持');
          return (
            <li key={s.type} className={`flex gap-2 ${tone}`}>
              <span className="w-3 shrink-0 text-center">{mark}</span>
              <span className="w-32 shrink-0">{s.label}</span>
              <span className="min-w-0 flex-1 wrap-anywhere">
                {note}
                {s.scope === 'global' && s.supported ? '（测试时会临时写入它自己的配置，测完删除；执行者暂不能用）' : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
