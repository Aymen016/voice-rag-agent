'use client';

import { AlertTriangle, BookCheck, CircleSlash, Wrench } from 'lucide-react';
import type { Grounding, Turn } from '@/lib/types';
import { AgentTrace } from './AgentTrace';
import { SourceList } from './SourceList';

const GROUNDING: Record<Grounding, { label: string; className: string; Icon: typeof BookCheck }> = {
  grounded: { label: 'Grounded in knowledge base', className: 'text-signal bg-signal/10', Icon: BookCheck },
  partial: { label: 'Partly supported', className: 'text-amber bg-amber/10', Icon: AlertTriangle },
  insufficient: { label: 'Not covered by knowledge base', className: 'text-amber bg-amber/10', Icon: CircleSlash },
  tools_only: { label: 'From account tools', className: 'text-ink-300 bg-ink-800', Icon: Wrench },
  not_needed: { label: 'No retrieval needed', className: 'text-ink-400 bg-ink-800', Icon: BookCheck },
};

/** Render [S1] markers as small citation chips. */
function withCitations(text: string) {
  const parts = text.split(/(\[S\d+(?:\s*,\s*S\d+)*\])/g);
  return parts.map((p, i) =>
    /^\[S\d+/.test(p) ? (
      <span key={i}>
        {p
          .slice(1, -1)
          .split(',')
          .map((id) => (
            <span key={id} className="cite">
              {id.trim()}
            </span>
          ))}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function Message({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink-800 px-4 py-2.5 text-[15px] leading-relaxed text-ink-100">
          {turn.text}
        </div>
      </div>
    );
  }

  if (turn.error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-ember/30 bg-ember/10 px-4 py-3 text-sm text-ember">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{turn.text}</span>
      </div>
    );
  }

  const g = turn.grounding ? GROUNDING[turn.grounding] : null;
  return (
    <div className="max-w-[92%]">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-semibold uppercase tracking-[0.14em] text-signal">Nova</span>
        {turn.intent && <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-ink-300">{turn.intent}</span>}
        {g && (
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${g.className}`}>
            <g.Icon className="h-3 w-3" />
            {g.label}
          </span>
        )}
        {turn.latencyMs !== undefined && <span className="font-mono text-ink-400">{(turn.latencyMs / 1000).toFixed(1)} s</span>}
      </div>
      <div className="text-[15px] leading-relaxed text-ink-100">{withCitations(turn.text)}</div>
      {turn.unsupportedClaims && turn.unsupportedClaims.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber">
          <div className="mb-1 font-medium">Not backed by any source:</div>
          <ul className="list-inside list-disc space-y-0.5 text-amber/90">
            {turn.unsupportedClaims.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {turn.sources && <SourceList sources={turn.sources} />}
      {turn.steps && turn.steps.length > 0 && <AgentTrace steps={turn.steps} />}
    </div>
  );
}
