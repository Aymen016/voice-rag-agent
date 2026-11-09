'use client';

import { FormEvent, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchResponse } from '@/lib/types';
import { ScoreBar } from './SourceList';

const EXAMPLES = ['I was billed two times', 'lost my authenticator phone', 'how big a video can I upload', 'do charities pay less'];

export function SearchInspector() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(query: string) {
    if (!query.trim()) return;
    setQ(query);
    setLoading(true);
    setError(null);
    try {
      setData(await api.search(query, 5));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(q);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-ink-400">
        The same semantic search the agent calls. Results are ranked by cosine similarity of sentence embeddings, so they match meaning, not keywords.
      </p>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the knowledge base…"
          className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-signal/60 focus:outline-none"
        />
        <button type="submit" className="rounded-md bg-ink-800 px-3 text-ink-100 hover:bg-ink-700" aria-label="Search">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => run(ex)} className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-ink-300 hover:border-signal/50 hover:text-signal">
            {ex}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-ember">{error}</p>}
      {data && (
        <div className="space-y-2">
          <div className="font-mono text-[11px] text-ink-400">
            {data.results.length} results · {data.tookMs} ms · sufficient ≥ {data.thresholds.sufficientScore}
          </div>
          {data.results.map((r) => (
            <div key={r.chunkId} className="rounded-lg border border-ink-700/70 bg-ink-900/60 p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-ink-400">#{r.rank}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-ink-100">{r.document}</span>
                  <span className="text-ink-400"> › {r.section}</span>
                </span>
                <ScoreBar score={r.score} threshold={data.thresholds.sufficientScore} />
              </div>
              <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-ink-300">{r.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
