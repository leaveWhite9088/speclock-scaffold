import { Chat } from '@/components/chat/Chat';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { HandoffBar } from '@/components/chat/HandoffBar';
import { CoreDrawer } from '@/components/drawer/CoreDrawer';
import { Drawer } from '@/components/drawer/Drawer';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { useUi } from '@/store';

export default function App() {
  useLiveEvents();
  const side = useUi((s) => s.widths.side);
  return (
    <div style={{ '--side-w': `${side}px` } as React.CSSProperties} className="grid h-screen grid-cols-[var(--side-w)_minmax(0,1fr)_auto] overflow-hidden max-[900px]:grid-cols-[220px_minmax(0,1fr)] max-[620px]:grid-cols-1 max-[620px]:grid-rows-[auto_minmax(0,1fr)]">
      <Sidebar />
      <main className="relative flex min-h-0 min-w-0 flex-col">
        <ChatHeader />
        <HandoffBar />
        <Chat />
      </main>
      <Drawer />
      <CoreDrawer />
    </div>
  );
}
