'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import type { KbDocumentSummary } from '@/lib/types';

export function KnowledgeBasePanel() {
  const [docs, setDocs] = useState<KbDocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.documents().then(setDocs).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-xs text-ember">{error}</p>;
  if (!docs) return <p className="text-xs text-ink-400">Loading documents (the first start embeds them, which can take a minute)…</p>;

  const chunks = docs.reduce((s, d) => s + d.chunks, 0);
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-400">
        {docs.length} documents, {chunks} chunks (split by section). Source files live in <span className="font-mono">knowledge-base/</span>.
      </p>
      {docs.map((d) => (
        <details key={d.id} className="group rounded-lg border border-ink-700/70 bg-ink-900/60">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
            <FileText className="h-3.5 w-3.5 text-ink-400" />
            <span className="flex-1 text-ink-100">{d.title}</span>
            <span className="font-mono text-[10px] text-ink-400">{d.chunks}</span>
          </summary>
          <ul className="border-t border-ink-700/70 px-3 py-2 text-[11px] text-ink-300">
            {d.sections.map((s, i) => (
              <li key={i} className="py-0.5">
                · {s}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
