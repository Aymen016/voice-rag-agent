export type AgentStatus = 'idle' | 'listening' | 'processing' | 'speaking';

export type Intent = 'knowledge_question' | 'account_request' | 'troubleshooting' | 'small_talk' | 'out_of_scope' | 'unknown';
export type Grounding = 'grounded' | 'partial' | 'insufficient' | 'tools_only' | 'not_needed';

export interface Source {
  id: string;
  chunkId: string;
  document: string;
  file: string;
  section: string;
  score: number;
  text: string;
}

export interface AgentStep {
  kind: 'intent' | 'tool' | 'thought' | 'verify' | 'answer' | 'error';
  title: string;
  input?: unknown;
  output?: unknown;
  summary?: string;
  ms?: number;
  ok?: boolean;
}

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  sources?: Source[];
  steps?: AgentStep[];
  intent?: Intent;
  grounding?: Grounding;
  unsupportedClaims?: string[];
  latencyMs?: number;
  error?: boolean;
}

export interface ChatResponse {
  sessionId: string;
  reply: string;
  speech: string;
  sources: Source[];
  steps: AgentStep[];
  intent: Intent;
  grounding: Grounding;
  latencyMs: number;
  turn: Turn;
}

export interface SearchHit {
  chunkId: string;
  docId: string;
  document: string;
  file: string;
  section: string;
  text: string;
  score: number;
  rank: number;
}

export interface SearchResponse {
  query: string;
  tookMs: number;
  thresholds: { minScore: number; sufficientScore: number };
  results: SearchHit[];
}

export interface KbDocumentSummary {
  id: string;
  file: string;
  title: string;
  sections: string[];
  chunks: number;
}

export interface Health {
  status: string;
  llm: { configured: boolean; model: string; baseUrl: string };
  embeddings: { provider: string; model: string };
  knowledgeBase: { ready: boolean; documents: number; chunks: number };
}
