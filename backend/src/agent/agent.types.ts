import { ChatMessage } from '../llm/llm.types';

export type Intent =
  | 'knowledge_question'
  | 'account_request'
  | 'troubleshooting'
  | 'small_talk'
  | 'out_of_scope'
  | 'unknown';

export interface Analysis {
  intent: Intent;
  is_follow_up: boolean;
  standalone_query: string;
  entities: Record<string, string>;
  planned_actions: string[];
  missing_info: string[];
}

export interface Source {
  id: string; // citation id, e.g. "S3"
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

export type Grounding = 'grounded' | 'partial' | 'insufficient' | 'tools_only' | 'not_needed';

export interface Verification {
  verdict: 'supported' | 'partially_supported' | 'unsupported' | 'no_claims';
  supported_source_ids: string[];
  unsupported_claims: string[];
}

export interface TranscriptTurn {
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

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** LLM-facing history: user, assistant (incl. tool_calls) and tool messages. */
  messages: ChatMessage[];
  /** Durable facts learned during the conversation (email, plan, invoice ids...). */
  facts: Record<string, string>;
  /** Human-facing transcript returned to the UI. */
  transcript: TranscriptTurn[];
  /** Monotonic counter so citation ids stay unique across the whole session. */
  sourceCounter: number;
  /** Email of the account found by get_customer_account for the current caller. Account actions only work on this one. */
  verifiedEmail?: string;
}

export interface TurnContext {
  session: Session;
  /** The caller's words this turn (used for consent checks). */
  userText?: string;
  /** Every chunk retrieved during this turn, keyed by citation id. */
  retrieved: Map<string, Source>;
  /** Assessment of each search this turn, used to decide grounding status. */
  searches: { query: string; assessment: 'sufficient' | 'weak' | 'none'; topScore: number }[];
  /** Short facts from non-KB tools (account, refund, status, ticket) for the verifier. */
  toolFacts?: string[];
}

export interface TurnResult {
  sessionId: string;
  reply: string;
  speech: string;
  sources: Source[];
  steps: AgentStep[];
  intent: Intent;
  grounding: Grounding;
  latencyMs: number;
  turn: TranscriptTurn;
}
