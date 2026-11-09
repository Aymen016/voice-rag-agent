'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import type { Source } from '@/lib/types';

export function ScoreBar({ score, threshold }: { score: number; threshold?: number }) {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  const strong = threshold === undefined ? score >= 0.45 : score >= threshold;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-ink-700">
        <span className={`absolute inset-y-0 left-0 rounded-full ${strong ? 'bg-signal' : 'bg-amber'}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[11px] text-ink-300">{score.toFixed(2)}</span>
    </span>
  );
}

export function SourceList({ sources }: { sources: Source[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!sources.length) return null;

  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-400">Sources</div>
      <ul className="space-y-1.5">
        {sources.map((s) => (
          <li key={s.id} className="rounded-lg border border-ink-700/70 bg-ink-900/60">
            <button
              type="button"
              onClick={() => setOpenId((o) => (o === s.id ? null : s.id))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
            >
              <span className="cite">{s.id}</span>
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-ink-100">{s.document}</span>
                <span className="text-ink-400"> › {s.section}</span>
              </span>
              <ScoreBar score={s.score} />
            </button>
            {openId === s.id && (
              <p className="whitespace-pre-wrap border-t border-ink-700/70 px-3 py-2 text-xs leading-relaxed text-ink-300">
                {s.text}
                <span className="mt-1 block font-mono text-[10px] text-ink-400">knowledge-base/{s.file}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
