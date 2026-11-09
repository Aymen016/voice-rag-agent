'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, Ear, Keyboard, ListChecks, RotateCcw, Search, Volume2, VolumeX } from 'lucide-react';
import { DemoScenarios } from '@/components/DemoScenarios';
import { KnowledgeBasePanel } from '@/components/KnowledgeBasePanel';
import { Message } from '@/components/Message';
import { SearchInspector } from '@/components/SearchInspector';
import { VoiceOrb } from '@/components/VoiceOrb';
import { useVoiceAgent } from '@/hooks/useVoiceAgent';
import { api } from '@/lib/api';
import type { Health } from '@/lib/types';

type Tab = 'scenarios' | 'search' | 'kb';

export default function Home() {
  const agent = useVoiceAgent();
  const [tab, setTab] = useState<Tab>('scenarios');
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll health until the knowledge base index is ready.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () =>
      api
        .health()
        .then((h) => {
          setHealth(h);
          setHealthError(null);
          if (!h.knowledgeBase.ready) timer = setTimeout(check, 3000);
        })
        .catch((e) => {
          setHealthError(e.message);
          timer = setTimeout(check, 4000);
        });
    check();
    return () => clearTimeout(timer);
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [agent.turns.length, agent.status]);

  // Space bar toggles the mic when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== 'Space' || e.repeat || ['INPUT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return;
      e.preventDefault();
      if (agent.status === 'speaking') agent.stopSpeaking();
      agent.toggleMic();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent]);

  const onOrbClick = () => {
    if (agent.status === 'speaking') {
      agent.stopSpeaking();
      agent.toggleMic(); // barge-in: interrupt and listen
    } else {
      agent.toggleMic();
    }
  };

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    void agent.send(draft);
    setDraft('');
  };

  const busy = agent.status === 'processing';

  return (
    <main className="mx-auto flex h-screen max-w-[1400px] flex-col gap-4 p-4 lg:flex-row lg:p-6">
      {/* Conversation column */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-ink-700/60 bg-ink-900/70 backdrop-blur">
        <header className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-3.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-signal/15 font-mono text-sm font-semibold text-signal">N</div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold tracking-tight">Nova · CloudNest voice support</h1>
            <HealthLine health={health} error={healthError} />
          </div>
          <button
            type="button"
            onClick={() => agent.reset()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:border-ink-600 hover:text-ink-100"
          >
            <RotateCcw className="h-3.5 w-3.5" /> New conversation
          </button>
        </header>

        <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6">
          {agent.turns.length === 0 && <EmptyState sttSupported={agent.sttSupported} />}
          {agent.turns.map((t) => (
            <Message key={t.id} turn={t} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
              Nova is working: understanding the request, choosing tools, checking sources…
            </div>
          )}
        </div>

        {/* Voice dock */}
        <div className="border-t border-ink-700/60 px-5 pb-4 pt-5">
          <div className="mx-auto mb-3 min-h-[1.5rem] max-w-2xl text-center text-[15px] text-ink-300">
            {agent.status === 'listening' ? agent.interim || <span className="text-ink-400">Go ahead, I’m listening…</span> : null}
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex w-40 flex-col gap-2">
              <Toggle on={agent.autoSpeak} onChange={agent.setAutoSpeak} icon={agent.autoSpeak ? Volume2 : VolumeX} label="Speak replies" />
              <Toggle on={agent.handsFree} onChange={agent.setHandsFree} icon={Ear} label="Hands-free" />
            </div>
            <VoiceOrb status={agent.status} onClick={onOrbClick} disabled={agent.sttSupported === false} />
            <div className="flex w-40 justify-end">
              <button
                type="button"
                onClick={() => setTyping((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-100"
              >
                <Keyboard className="h-3.5 w-3.5" /> {typing ? 'Hide keyboard' : 'Type instead'}
              </button>
            </div>
          </div>
          {typing && (
            <form onSubmit={submitTyped} className="mx-auto mt-4 flex max-w-2xl gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Fallback for browsers without speech recognition…"
                className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm placeholder:text-ink-400 focus:border-signal/60 focus:outline-none"
              />
              <button type="submit" disabled={busy} className="rounded-lg bg-signal px-4 text-sm font-medium text-ink-950 disabled:opacity-50">
                Send
              </button>
            </form>
          )}
          {agent.error && <p className="mt-3 text-center text-xs text-ember">{agent.error}</p>}
          <p className="mt-3 text-center text-[11px] text-ink-400">Press space to talk · tap while Nova speaks to interrupt</p>
        </div>
      </section>

      {/* Inspector column */}
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ink-700/60 bg-ink-900/70 lg:w-[400px]">
        <nav className="flex border-b border-ink-700/60 p-1.5">
          <TabButton active={tab === 'scenarios'} onClick={() => setTab('scenarios')} icon={ListChecks} label="Demo script" />
          <TabButton active={tab === 'search'} onClick={() => setTab('search')} icon={Search} label="Semantic search" />
          <TabButton active={tab === 'kb'} onClick={() => setTab('kb')} icon={BookOpen} label="Knowledge base" />
        </nav>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'scenarios' && <DemoScenarios onSend={(t) => void agent.send(t)} disabled={busy} />}
          {tab === 'search' && <SearchInspector />}
          {tab === 'kb' && <KnowledgeBasePanel />}
        </div>
      </aside>
    </main>
  );
}

function HealthLine({ health, error }: { health: Health | null; error: string | null }) {
  if (error) return <p className="truncate text-[11px] text-ember">Backend unreachable: {error}</p>;
  if (!health) return <p className="text-[11px] text-ink-400">Connecting…</p>;
  const kb = health.knowledgeBase;
  return (
    <p className="truncate font-mono text-[11px] text-ink-400">
      <Dot ok={health.llm.configured} /> {health.llm.configured ? health.llm.model : 'LLM key missing (backend/.env)'}
      <span className="mx-2 text-ink-600">|</span>
      <Dot ok={kb.ready} /> {kb.ready ? `${kb.documents} docs · ${kb.chunks} chunks` : 'indexing knowledge base…'}
      <span className="mx-2 text-ink-600">|</span>
      {health.embeddings.model.replace(/^local:/, '')}
    </p>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${ok ? 'bg-signal' : 'bg-amber'}`} />;
}

function Toggle({ on, onChange, icon: Icon, label }: { on: boolean; onChange: (v: boolean) => void; icon: typeof Ear; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2 text-xs text-ink-300 hover:text-ink-100" aria-pressed={on}>
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-signal/80' : 'bg-ink-700'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-ink-950 transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Search; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors ${
        active ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-100'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EmptyState({ sttSupported }: { sttSupported: boolean | null }) {
  return (
    <div className="mx-auto mt-10 max-w-md text-center">
      <h2 className="text-xl font-semibold tracking-tight">Talk to CloudNest support</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">
        Ask about plans, billing, refunds, security or sync problems. Nova searches the help center, uses account tools when needed, and tells you which documents
        its answer came from.
      </p>
      {sttSupported === false && (
        <p className="mt-4 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
          This browser has no speech recognition. Open the app in Chrome or Edge for voice, or use “Type instead”.
        </p>
      )}
    </div>
  );
}
