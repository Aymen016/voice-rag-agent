import type { ChatResponse, Health, KbDocumentSummary, SearchResponse, Turn } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error('Cannot reach the backend. Is it running on port 4000?');
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let fromBackend = false;
    try {
      const body = await res.json();
      message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message ?? message;
      fromBackend = true;
    } catch {
      /* non-JSON error body */
    }
    // Next's proxy answers a bare (non-JSON) 500 both when nothing listens on
    // port 4000 and when the backend took longer than the proxy timeout.
    // Ask /health to tell the two apart instead of guessing.
    if (res.status === 500 && !fromBackend) {
      const alive = await fetch('/api/health').then((r) => r.ok).catch(() => false);
      message = alive
        ? 'Nova took too long to answer (the free LLM tier is probably rate-limiting). Please ask again in a few seconds.'
        : 'Backend is not running. Start it with "npm run start:dev" in the backend folder.';
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  chat: (sessionId: string, message: string) =>
    request<ChatResponse>('/agent/chat', { method: 'POST', body: JSON.stringify({ sessionId, message }) }),
  session: (sessionId: string) => request<{ sessionId: string; turns: Turn[]; facts: Record<string, string>; busy: boolean }>(`/agent/sessions/${sessionId}`),
  reset: (sessionId: string) => request<{ reset: boolean }>(`/agent/sessions/${sessionId}`, { method: 'DELETE' }),
  search: (q: string, k = 5) => request<SearchResponse>(`/kb/search?q=${encodeURIComponent(q)}&k=${k}`),
  documents: () => request<KbDocumentSummary[]>('/kb/documents'),
  health: () => request<Health>('/health'),
};
