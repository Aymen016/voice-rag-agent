'use client';

import { Loader2, Mic, Square, Volume2 } from 'lucide-react';
import type { AgentStatus } from '@/lib/types';

const LABEL: Record<AgentStatus, string> = {
  idle: 'Tap to talk',
  listening: 'Listening… tap to send',
  processing: 'Thinking…',
  speaking: 'Speaking… tap to interrupt',
};

export function VoiceOrb({ status, onClick, disabled }: { status: AgentStatus; onClick: () => void; disabled?: boolean }) {
  const ring =
    status === 'listening'
      ? 'bg-ember'
      : status === 'speaking'
        ? 'bg-signal'
        : status === 'processing'
          ? 'bg-amber'
          : 'bg-ink-600';

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || status === 'processing'}
        aria-label={LABEL[status]}
        className="group relative grid h-20 w-20 place-items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed"
      >
        {(status === 'listening' || status === 'speaking') && (
          <>
            <span className={`absolute inset-0 rounded-full ${ring} animate-ripple`} />
            <span className={`absolute inset-0 rounded-full ${ring} animate-ripple [animation-delay:0.8s]`} />
          </>
        )}
        <span
          className={`relative grid h-20 w-20 place-items-center rounded-full border transition-colors ${
            status === 'listening'
              ? 'border-ember/60 bg-ember text-ink-950'
              : status === 'speaking'
                ? 'border-signal/60 bg-signal text-ink-950'
                : status === 'processing'
                  ? 'border-amber/50 bg-ink-800 text-amber'
                  : 'border-ink-600 bg-ink-800 text-ink-100 group-hover:border-signal/60 group-hover:text-signal'
          }`}
        >
          {status === 'listening' && <Square className="h-6 w-6" fill="currentColor" />}
          {status === 'processing' && <Loader2 className="h-7 w-7 animate-spin" />}
          {status === 'speaking' && <SpeakingBars />}
          {status === 'idle' && <Mic className="h-7 w-7" />}
        </span>
      </button>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-ink-400">
        {status === 'speaking' && <Volume2 className="h-3.5 w-3.5" />}
        {LABEL[status]}
      </div>
    </div>
  );
}

function SpeakingBars() {
  return (
    <span className="flex h-7 items-center gap-1" aria-hidden>
      {[0, 0.15, 0.3, 0.45].map((d) => (
        <span key={d} className="h-full w-1.5 origin-center rounded-full bg-ink-950 animate-bar" style={{ animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}
