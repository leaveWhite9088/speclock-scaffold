import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUpToLine, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { api, enc, pq } from '@/lib/api';
import { useExecutorSessions, useSelectedMember } from '@/hooks/queries';
import { useUi } from '@/store';
import { useConversation } from '@/hooks/useConversation';
import type { Item } from '@/lib/types';
import { Composer } from './Composer';
import { DispatchLine } from './DispatchLine';
import { ThoughtBlock } from './ThoughtBlock';
import { TurnStatus } from './TurnStatus';
import { Message } from './Message';
import { ReportLine } from './ReportLine';
import { ToolGroup } from './ToolGroup';

type Block =
  | { kind: 'say'; item: Extract<Item, { kind: 'user' | 'assistant' | 'error' }> }
  | { kind: 'dispatch'; item: Extract<Item, { kind: 'dispatch' }> }
  | { kind: 'thought'; item: Extract<Item, { kind: 'thought' }> }
  | { kind: 'report'; item: Extract<Item, { kind: 'report' }> }
  | { kind: 'tools'; id: string; tools: Extract<Item, { kind: 'tool' }>[] };

/** Consecutive tool items become one collapsible group. */
function blocks(items: Item[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    if (item.kind === 'dispatch') out.push({ kind: 'dispatch', item });
    else if (item.kind === 'thought') out.push({ kind: 'thought', item });
    else if (item.kind === 'report') out.push({ kind: 'report', item });
    else if (item.kind !== 'tool') out.push({ kind: 'say', item });
    else {
      const last = out.at(-1);
      if (last?.kind === 'tools') last.tools.push(item);
      else out.push({ kind: 'tools', id: item.id, tools: [item] });
    }
  }
  return out;
}

function Empty({ hasProject, isDispatcher, hasMembers }: { hasProject: boolean; isDispatcher: boolean; hasMembers: boolean }) {
  const title = !hasProject ? '先建一个项目' : isDispatcher ? (hasMembers ? '和调度器说你要做什么' : '先新建一个执行者') : '还没有对话';
  return (
    <div className="mx-auto mt-[14vh] max-w-[740px] px-6">
      <h2 className="m-0 text-[19px] font-semibold tracking-tight text-ink">{title}</h2>
    </div>
  );
}

/** Shown while the page looks at a conversation the executor is not in (it is working in another one): what that means, and the way out. */
function ViewingBanner({ memberKey, active }: { memberKey: string; active?: string | null }) {
  const id = useUi((s) => s.viewing[memberKey]);
  const setViewing = useUi((s) => s.setViewing);
  const qc = useQueryClient();
  const { data: sessions } = useExecutorSessions(memberKey, Boolean(id));
  if (!id || id === active) return null; // the executor has come to this conversation itself: nothing to explain
  const title = sessions?.find((s) => s.sessionId === id);
  const switchTo = async () => {
    try {
      await api('POST', `/api/agents/${enc(memberKey)}/use`, { sessionId: id });
      setViewing(memberKey, null);
      toast('已排队：当前任务做完后切换到这个会话');
      await qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="mx-6 mt-1 flex shrink-0 items-center gap-3 rounded-md border border-line bg-raised px-3 py-1.5 text-[12.5px] text-ink-2">
      <span className="min-w-0 flex-1 truncate">
        正在查看「{title?.label || title?.title || id.slice(0, 8)}」：执行者在别的会话里，不受影响。现在发的消息会发到这个会话，排在当前任务后面。
      </span>
      <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => void switchTo()}>
        切换到这个会话
      </button>
      <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => setViewing(memberKey, null)}>
        回到当前会话
      </button>
    </div>
  );
}

export function Chat() {
  const { project, sel, member, isDispatcher } = useSelectedMember();
  const { items, loading, send, turn } = useConversation(project?.id ?? '', sel, member, Boolean(project?.dispatcher?.busy));
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false); // scrolled up: offer the way back down

  // Follow the conversation only while the reader is at the bottom.
  useLayoutEffect(() => {
    const s = scroller.current;
    if (s && stick.current) s.scrollTop = s.scrollHeight;
  }, [items]);
  // Not only new messages change the height: a queued message, the "thinking" line and the tool groups opening and closing do too.
  // Watching the content's own height keeps the end in view whatever changed it.
  useEffect(() => {
    const el = content.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const s = scroller.current;
      if (s && stick.current) s.scrollTop = s.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    stick.current = true; // a different conversation starts at its end
  }, [sel, project?.id]);

  const onScroll = () => {
    const s = scroller.current;
    if (!s) return;
    const far = s.scrollHeight - s.scrollTop - s.clientHeight;
    stick.current = far < 80;
    setAway(far > 160);
  };
  const jump = () => {
    const s = scroller.current;
    if (!s) return;
    stick.current = true;
    s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
  };

  const list = blocks(items);
  const qc = useQueryClient();
  const waitingMsgs = isDispatcher ? (project?.dispatcher?.queued ?? []) : [];
  const dequeue = async (index: number) => {
    try {
      await api('POST', `/api/dispatcher/dequeue${pq(project?.id ?? '')}`, { index });
    } catch (e) {
      toast((e as Error).message);
    }
    await qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const promoteMsg = async (index: number) => {
    try {
      await api('POST', `/api/dispatcher/promote${pq(project?.id ?? '')}`, { index });
    } catch (e) {
      toast((e as Error).message);
    }
    await qc.invalidateQueries({ queryKey: ['projects'] });
  };
  // Which dispatched tasks wait behind another: an executor works on one thing at a time, in order, so of its
  // unfinished dispatches the newest `waiting` ones are the queued ones (the server counts them).
  const queued = new Map<string, { agent: string; jobId?: string; ahead?: number }>();
  if (isDispatcher && project) {
    const open = items.filter((i): i is Extract<Item, { kind: 'dispatch' }> => i.kind === 'dispatch' && i.state === 'run');
    for (const m of project.instances) {
      const lines = open.filter((d) => d.agent === m.id);
      const mine = lines.slice(Math.max(0, lines.length - (m.waiting ?? 0)));
      const jobs = m.waitingJobs ?? [];
      // The line can be reordered, so a task is found by its own job id; the newest-N guess is only for one that has none yet.
      mine.forEach((d, i) => {
        const at = d.jobId ? jobs.findIndex((j) => j.jobId === d.jobId) : -1;
        const jobId = at >= 0 ? d.jobId : jobs[jobs.length - mine.length + i]?.jobId;
        const pos = at >= 0 ? at : jobs.length - mine.length + i;
        queued.set(d.id, { agent: m.key, jobId, ahead: pos >= 0 ? pos + (m.busy ? 1 : 0) : undefined });
      });
    }
  }
  const cancelJob = async (agent: string, jobId: string) => {
    try {
      await api('POST', `/api/agents/${enc(agent)}/cancel`, { jobId });
    } catch (e) {
      toast((e as Error).message);
    }
    await qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const promoteJob = async (agent: string, jobId: string) => {
    try {
      const r = await api<{ promoted?: boolean; reason?: string }>('POST', `/api/agents/${enc(agent)}/promote`, { jobId });
      if (r?.promoted === false) toast(`没能插队：${r.reason ?? '它已经不在排队了'}`);
    } catch (e) {
      toast((e as Error).message);
    }
    await qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const waitingJobs = !isDispatcher && member ? (member.waitingJobs ?? []) : [];
  return (
    <>
      {!isDispatcher && member ? <ViewingBanner memberKey={member.key} active={member.preferSession} /> : null}
      <div className="relative flex min-h-0 min-w-0 flex-1">
      <div ref={scroller} onScroll={onScroll} tabIndex={-1} aria-live="polite" className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-1">
        <div ref={content}>
        {list.length === 0 ? (
          loading ? null : <Empty hasProject={Boolean(project)} isDispatcher={isDispatcher} hasMembers={Boolean(project?.instances.length)} />
        ) : (
          <div className="mx-auto grid max-w-[740px] grid-cols-[minmax(0,1fr)] gap-3.5 px-6 pt-1.5 pb-3 *:min-w-0">
            {list.map((b) =>
              b.kind === 'say' ? <Message key={b.item.id} item={b.item} /> : b.kind === 'dispatch' ? <DispatchLine key={b.item.id} item={b.item} queued={queued.has(b.item.id)} ahead={queued.get(b.item.id)?.ahead} onPromote={queued.get(b.item.id)?.jobId && (queued.get(b.item.id)?.ahead ?? 0) > (project?.instances.find((m) => m.key === queued.get(b.item.id)!.agent)?.busy ? 1 : 0) ? () => void promoteJob(queued.get(b.item.id)!.agent, queued.get(b.item.id)!.jobId!) : undefined} onCancel={queued.get(b.item.id)?.jobId ? () => void cancelJob(queued.get(b.item.id)!.agent, queued.get(b.item.id)!.jobId!) : undefined} /> : b.kind === 'thought' ? <ThoughtBlock key={b.item.id} item={b.item} /> : b.kind === 'report' ? <ReportLine key={b.item.id} item={b.item} /> : <ToolGroup key={b.id} tools={b.tools} />,
            )}
          </div>
        )}
        {waitingMsgs.length ? (
          <div className="mx-auto grid max-w-[740px] grid-cols-[minmax(0,1fr)] gap-2 px-6 pb-3 *:min-w-0">
            {waitingMsgs.map((m, i) => (
              <div key={`${i}-${m.slice(0, 20)}`} className="flex items-center justify-end gap-2 text-[12.5px] text-muted">
                <span className="shrink-0">排队中</span>
                <span className="max-w-[70%] truncate rounded-lg bg-bubble px-3 py-[7px] text-sm text-ink opacity-70">{m}</span>
                {i > 0 ? (
                  <button type="button" aria-label="插队" title="插队：排到下一个" className="shrink-0 rounded p-1 hover:bg-hover hover:text-ink" onClick={() => void promoteMsg(i)}>
                    <ArrowUpToLine className="size-3.5" />
                  </button>
                ) : null}
                <button type="button" aria-label="取消排队" title="取消排队" className="shrink-0 rounded p-1 hover:bg-hover hover:text-ink" onClick={() => void dequeue(i)}>
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {waitingJobs.length ? (
          <div className="mx-auto grid max-w-[740px] grid-cols-[minmax(0,1fr)] gap-2 px-6 pb-3 *:min-w-0">
            {waitingJobs.map((j, i) => (
              <div key={j.jobId} className="flex items-center justify-end gap-2 text-[12.5px] text-muted">
                <span className="shrink-0">排队中</span>
                <span className="max-w-[70%] truncate rounded-lg bg-bubble px-3 py-[7px] text-sm text-ink opacity-70">{j.text}</span>
                {i > 0 ? (
                  <button type="button" aria-label="插队" title="插队：排到下一个" className="shrink-0 rounded p-1 hover:bg-hover hover:text-ink" onClick={() => void promoteJob(member!.key, j.jobId)}>
                    <ArrowUpToLine className="size-3.5" />
                  </button>
                ) : null}
                <button type="button" aria-label="取消排队" title="取消排队" className="shrink-0 rounded p-1 hover:bg-hover hover:text-ink" onClick={() => void cancelJob(member!.key, j.jobId)}>
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {turn ? <TurnStatus turn={turn} /> : null}
        <div aria-hidden className="h-12" />
        </div>
      </div>
      {away ? (
        <button
          type="button"
          aria-label="回到最新"
          title="回到最新"
          onClick={jump}
          className="absolute right-8 bottom-4 flex size-9 items-center justify-center rounded-full border border-line bg-raised text-ink-2 shadow-md hover:bg-hover hover:text-ink"
        >
          <ArrowDown className="size-4" />
        </button>
      ) : null}
      </div>
      {project ? (
        <Composer
          placeholder={isDispatcher ? '告诉调度器要做什么（Enter 发送，Shift+Enter 换行）' : `直接对 ${member?.id ?? ''} 说话（Enter 发送，Shift+Enter 换行）`}
          busy={isDispatcher ? Boolean(project.dispatcher?.busy) : Boolean(member?.busy)}
          onSend={(text) => {
            stick.current = true;
            return send(text);
          }}
        />
      ) : null}
    </>
  );
}
