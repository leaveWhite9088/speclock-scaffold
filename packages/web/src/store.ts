import { create } from 'zustand';

/** `sel` is DISPATCHER or an executor's key ("project~id"). */
export const DISPATCHER = '@dispatcher';

/** A running executor: when its task started (this page's clock). */
export interface Activity {
  startedAt: number;
}

/** The three panes' widths in px (the middle one takes the rest): the project list, the settings drawer, the spec library drawer. */
export interface Widths {
  side: number;
  settings: number;
  core: number;
}
export const DEFAULT_WIDTHS: Widths = { side: 256, settings: 330, core: 620 };
export const WIDTH_LIMITS: Record<keyof Widths, [number, number]> = { side: [180, 420], settings: [280, 640], core: [360, 1100] };

function loadWidths(): Widths {
  try {
    const saved = JSON.parse(localStorage.getItem('widths') ?? '{}') as Partial<Widths>;
    const w = { ...DEFAULT_WIDTHS };
    for (const k of Object.keys(w) as (keyof Widths)[]) {
      const v = Number(saved[k]);
      if (Number.isFinite(v) && v >= WIDTH_LIMITS[k][0] && v <= WIDTH_LIMITS[k][1]) w[k] = v;
    }
    return w;
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

interface UiState {
  widths: Widths;
  setWidth: (k: keyof Widths, v: number | null) => void;
  /** The spec library (SpecLock Core's own page) in a drawer; it and the settings drawer share the right edge, one at a time. */
  core: boolean;
  setCore: (open: boolean) => void;
  /** Running executors, by key ("project~id"). */
  activity: Record<string, Activity>;
  setActivity: (key: string, a: Activity | null) => void;
  project: string;
  sel: string;
  drawer: boolean;
  /** SSE connection to the backend. */
  conn: 'connecting' | 'on' | 'off';
  /** Bumped when the conversation on screen must be read again (a session was switched or created). */
  conversationVersion: number;
  /**
   * Executors (by key) whose page shows a conversation other than the one the executor is in: it is working, and looking at another
   * one must not switch it (the switch would wait behind the task anyway). Read-only, from the transcript on disk.
   */
  viewing: Record<string, string>;
  setViewing: (key: string, sessionId: string | null) => void;
  setProject: (id: string) => void;
  select: (key: string) => void;
  setDrawer: (open: boolean) => void;
  setConn: (c: UiState['conn']) => void;
  reloadConversation: () => void;
}

export const useUi = create<UiState>((set) => ({
  widths: loadWidths(),
  setWidth: (k, v) =>
    set((s) => {
      const widths = { ...s.widths, [k]: v ?? DEFAULT_WIDTHS[k] };
      localStorage.setItem('widths', JSON.stringify(widths));
      return { widths };
    }),
  core: false,
  setCore: (open) => set(open ? { core: true, drawer: false } : { core: false }),
  activity: {},
  setActivity: (key, a) =>
    set((s) => {
      const next = { ...s.activity };
      if (a) next[key] = a;
      else delete next[key];
      return { activity: next };
    }),
  project: localStorage.getItem('project') ?? '',
  sel: DISPATCHER,
  drawer: false,
  conn: 'connecting',
  conversationVersion: 0,
  viewing: {},
  setViewing: (key, sessionId) =>
    set((s) => {
      const viewing = { ...s.viewing };
      if (sessionId) viewing[key] = sessionId;
      else delete viewing[key];
      return { viewing, conversationVersion: s.conversationVersion + 1 };
    }),
  setProject: (id) => {
    localStorage.setItem('project', id);
    set({ project: id, sel: DISPATCHER });
  },
  select: (key) => set({ sel: key }),
  setDrawer: (open) => set(open ? { drawer: true, core: false } : { drawer: false }),
  setConn: (conn) => set({ conn }),
  reloadConversation: () => set((s) => ({ conversationVersion: s.conversationVersion + 1 })),
}));
