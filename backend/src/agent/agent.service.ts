import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { cfg } from '../config';
import { LlmService } from '../llm/llm.service';
import { ChatMessage } from '../llm/llm.types';
import { ToolRegistry } from '../tools/tool.registry';
import { AgentStep, Analysis, Grounding, Intent, Session, Source, TranscriptTurn, TurnContext, TurnResult, Verification } from './agent.types';
import { agentSystemPrompt, analyzerInput, analyzerPrompt, verifierInput, verifierPrompt } from './prompts';
import { SessionStore } from './session.store';
import { extractCitationIds, filterCitations, normalizeModelText, toSpeech } from './text';

const INTENTS: Intent[] = ['knowledge_question', 'account_request', 'troubleshooting', 'small_talk', 'out_of_scope'];
const FALLBACK_ANSWER = "Sorry, I couldn't put together a reliable answer for that. Could you rephrase, or would you like me to open a support ticket?";

/**
 * One conversational turn:
 *
 * 1. Analyze: a small JSON call classifies intent, rewrites follow-ups into a
 *    standalone question, extracts entities into session memory.
 * 2. Agent loop: the LLM chooses tools (native function calling). We run
 *    them, feed results back, and repeat until it answers or hits MAX_STEPS.
 *    Search results carry an "assessment" so the model can re-query or decline.
 * 3. Verify: a separate call checks the final answer against the retrieved
 *    passages and tool results, attributes sources, and flags unsupported
 *    claims. Grounding is decided here, not by trusting the model's own
 *    citations (which small models drop or invent).
 * 4. Post-process: citations, speech text, compact memory.
 *
 * Turns for the same session run one at a time (a per-session queue), and the
 * whole turn has a time budget so a rate-limited free tier fails fast with a
 * clear message instead of hanging the browser.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly llm: LlmService,
    private readonly tools: ToolRegistry,
    private readonly sessions: SessionStore,
  ) {}

  /** Serializes turns per session so concurrent requests can't interleave history. */
  handleTurn(sessionId: string | undefined, userText: string): Promise<TurnResult> {
    const session = this.sessions.getOrCreate(sessionId);
    const previous = this.queues.get(session.id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.runTurn(session, userText));
    this.queues.set(session.id, run);
    const cleanup = () => {
      if (this.queues.get(session.id) === run) this.queues.delete(session.id);
    };
    run.then(cleanup, cleanup);
    return run;
  }

  isBusy(sessionId: string): boolean {
    return this.queues.has(sessionId);
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  resetSession(id: string): boolean {
    return this.sessions.delete(id);
  }

  // ------------------------------------------------------------------ turn

  private async runTurn(session: Session, userText: string): Promise<TurnResult> {
    const started = Date.now();
    const deadline = started + cfg().agent.turnTimeoutMs;
    const steps: AgentStep[] = [];
    const text = userText.trim().slice(0, 2000);
    const ctx: TurnContext = { session, userText: text, retrieved: new Map(), searches: [] };

    session.transcript.push({ id: randomUUID(), role: 'user', text, at: new Date().toISOString() });

    try {
      // 1. Intent recognition + query rewriting + entity memory
      const analysis = await this.analyze(session, text, steps, deadline);

      // 2. Agentic tool loop
      const { answer: rawAnswer, toolMessages } = await this.toolLoop(session, text, analysis, ctx, steps, deadline);
      const answer = rawAnswer || FALLBACK_ANSWER;

      // 3. Verification and source attribution
      const verification = await this.verify(answer, ctx, steps, deadline);
      const cited = this.citedSources(answer, ctx);
      const sources = mergeSources(cited, verification ? verification.supported_source_ids.map((id) => ctx.retrieved.get(id)).filter(isSource) : []);
      const toolCalls = steps.filter((s) => s.kind === 'tool').length;
      const grounding = this.grounding(ctx, sources, toolCalls, verification);

      // 4. Output
      const reply = this.cleanReply(answer, ctx);
      const speech = toSpeech(reply);
      steps.push({
        kind: 'answer',
        title: 'Answer',
        summary: `${GROUNDING_LABEL[grounding]}${sources.length ? `, ${sources.length} source(s)` : ''}`,
      });

      this.remember(session, text, answer, toolMessages);

      const latencyMs = Date.now() - started;
      const intent = analysis?.intent ?? 'unknown';
      const turn: TranscriptTurn = {
        id: randomUUID(),
        role: 'assistant',
        text: reply,
        at: new Date().toISOString(),
        sources,
        steps,
        intent,
        grounding,
        unsupportedClaims: verification?.unsupported_claims ?? [],
        latencyMs,
      };
      session.transcript.push(turn);
      session.updatedAt = new Date().toISOString();
      this.logger.log(
        `[${session.id.slice(0, 8)}] ${intent} | ${steps.filter((s) => s.kind === 'tool').map((s) => s.title).join(' > ') || 'no tools'} | ${grounding} | ${latencyMs} ms`,
      );
      return { sessionId: session.id, reply, speech, sources, steps, intent, grounding, latencyMs, turn };
    } catch (err: any) {
      // Keep the transcript consistent: a failed turn gets an error entry so a
      // reloaded page doesn't wait forever for an answer that will never come.
      const message = err instanceof HttpException ? String(err.message) : 'The language model request failed.';
      session.transcript.push({ id: randomUUID(), role: 'assistant', text: message, at: new Date().toISOString(), error: true });
      throw err;
    }
  }

  private async toolLoop(session: Session, text: string, analysis: Analysis | null, ctx: TurnContext, steps: AgentStep[], deadline: number) {
    const system = agentSystemPrompt({ facts: session.facts, analysis, today: new Date().toISOString().slice(0, 10) });
    const history = this.sessions.recentHistory(session, cfg().agent.historyMessages);
    const working: ChatMessage[] = [{ role: 'user', content: text }];
    const specs = this.tools.specs();
    const maxSteps = Math.max(2, cfg().agent.maxSteps);

    for (let step = 1; step <= maxSteps; step++) {
      const lastChance = step === maxSteps;
      const t0 = Date.now();
      const msg = await this.llm.chat([{ role: 'system', content: system }, ...history, ...working], {
        tools: specs,
        // On the last step force a natural-language answer from what we have.
        toolChoice: lastChance ? 'none' : 'auto',
        deadline,
      });

      if (msg.tool_calls?.length && !lastChance) {
        working.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
        if (msg.content?.trim()) steps.push({ kind: 'thought', title: 'Reasoning', summary: msg.content.trim(), ms: Date.now() - t0 });
        for (const call of msg.tool_calls) {
          const tt = Date.now();
          const outcome = await this.tools.execute(call.function.name, call.function.arguments, ctx);
          steps.push({ kind: 'tool', title: call.function.name, input: outcome.args, output: outcome.result, summary: outcome.summary, ok: outcome.ok, ms: Date.now() - tt });
          working.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result) });
        }
        continue;
      }
      return { answer: normalizeModelText(msg.content ?? ''), toolMessages: working.slice(1) };
    }
    return { answer: '', toolMessages: working.slice(1) };
  }

  // ------------------------------------------------------------------ analyze

  private async analyze(session: Session, text: string, steps: AgentStep[], deadline: number): Promise<Analysis | null> {
    const t0 = Date.now();
    const transcript = session.transcript
      .slice(-7, -1)
      .map((t) => `${t.role === 'user' ? 'Customer' : 'Agent'}: ${truncate(t.text, 400)}`)
      .join('\n');
    try {
      const raw = await this.llm.chatJson<Partial<Analysis>>(
        [
          { role: 'system', content: analyzerPrompt() },
          { role: 'user', content: analyzerInput(transcript, session.facts, text) },
        ],
        // Reasoning models spend tokens thinking before the JSON; leave room.
        { temperature: 0, maxTokens: 1500, deadline },
      );
      if (!raw || typeof raw !== 'object') throw new Error('empty analyzer output');
      const analysis: Analysis = {
        intent: toIntent(raw.intent),
        is_follow_up: Boolean(raw.is_follow_up),
        standalone_query: typeof raw.standalone_query === 'string' && raw.standalone_query.trim() ? raw.standalone_query.trim() : text,
        entities: sanitizeEntities(raw.entities),
        planned_actions: Array.isArray(raw.planned_actions) ? raw.planned_actions.map(String).slice(0, 6) : [],
        missing_info: Array.isArray(raw.missing_info) ? raw.missing_info.map(String).slice(0, 5) : [],
      };
      this.rememberEntities(session, analysis.entities);
      steps.push({
        kind: 'intent',
        title: 'Intent recognition',
        summary: `${analysis.intent}${analysis.is_follow_up ? ' (follow-up)' : ''} | "${analysis.standalone_query}"`,
        output: analysis,
        ok: true,
        ms: Date.now() - t0,
      });
      return analysis;
    } catch (err: any) {
      // Rate limits and missing keys must surface; anything else just skips the hint.
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Analyzer failed, continuing without it: ${err?.message}`);
      steps.push({ kind: 'intent', title: 'Intent recognition', summary: 'Skipped (analyzer error)', ok: false, ms: Date.now() - t0 });
      return null;
    }
  }

  // ------------------------------------------------------------------ verify

  /**
   * Grounding check. Runs only when the knowledge base was consulted this
   * turn. Returns null (and the caller falls back to citations) if disabled,
   * out of time, or the verifier output is unusable.
   */
  private async verify(answer: string, ctx: TurnContext, steps: AgentStep[], deadline: number): Promise<Verification | null> {
    if (!cfg().agent.verify || ctx.retrieved.size === 0) return null;
    if (deadline - Date.now() < 8000) {
      steps.push({ kind: 'verify', title: 'Grounding check', summary: 'Skipped (turn time budget)', ok: false });
      return null;
    }
    const t0 = Date.now();
    const passages = [...ctx.retrieved.values()].map((s) => ({ id: s.id, text: `${s.document} > ${s.section}: ${s.text}` }));
    try {
      const raw = await this.llm.chatJson<Partial<Verification>>(
        [
          { role: 'system', content: verifierPrompt() },
          { role: 'user', content: verifierInput(answer, passages, ctx.toolFacts ?? []) },
        ],
        { temperature: 0, maxTokens: 1200, deadline },
      );
      if (!raw || typeof raw !== 'object') throw new Error('empty verifier output');
      const verdicts = ['supported', 'partially_supported', 'unsupported', 'no_claims'] as const;
      const v: Verification = {
        verdict: verdicts.includes(raw.verdict as any) ? (raw.verdict as Verification['verdict']) : 'unsupported',
        supported_source_ids: Array.isArray(raw.supported_source_ids)
          ? raw.supported_source_ids.map((x) => String(x).trim().replace(/^\[|\]$/g, '')).filter((id) => ctx.retrieved.has(id))
          : [],
        unsupported_claims: Array.isArray(raw.unsupported_claims) ? raw.unsupported_claims.map(String).slice(0, 5) : [],
      };
      steps.push({
        kind: 'verify',
        title: 'Grounding check',
        summary: `${v.verdict.replace('_', ' ')}; supported by ${v.supported_source_ids.join(', ') || 'no passages'}${v.unsupported_claims.length ? `; unsupported: ${v.unsupported_claims.join(' | ')}` : ''}`,
        output: v,
        ok: v.verdict !== 'unsupported',
        ms: Date.now() - t0,
      });
      return v;
    } catch (err: any) {
      this.logger.warn(`Verifier failed, using citations only: ${err?.message}`);
      steps.push({ kind: 'verify', title: 'Grounding check', summary: 'Skipped (verifier error)', ok: false, ms: Date.now() - t0 });
      return null;
    }
  }

  /**
   * grounded:     KB passages support the answer and nothing unsupported was found
   * partial:      some claims supported, some not
   * insufficient: KB consulted but it doesn't support an answer (or answer declines)
   * tools_only:   answered from tool data (account, status, ticket) only
   * not_needed:   small talk / clarification
   */
  private grounding(ctx: TurnContext, sources: Source[], toolCalls: number, v: Verification | null): Grounding {
    if (ctx.retrieved.size > 0) {
      if (v) {
        if (v.verdict === 'supported') return sources.length ? 'grounded' : 'tools_only';
        if (v.verdict === 'partially_supported') return 'partial';
        return 'insufficient';
      }
      return sources.length ? 'grounded' : 'insufficient';
    }
    return toolCalls > 0 ? 'tools_only' : 'not_needed';
  }

  // ------------------------------------------------------------------ memory

  /**
   * Long-term memory is compact on purpose: earlier turns are kept as plain
   * user/assistant text, and anything that matters later (email, invoice,
   * refund amount, ticket id) lives in `facts`. Replaying every past tool
   * payload made prompts grow by thousands of tokens per turn, which is what
   * triggered free-tier rate limits and 60 to 80 second turns.
   */
  private remember(session: Session, userText: string, answer: string, _toolMessages: ChatMessage[]) {
    session.messages.push({ role: 'user', content: userText }, { role: 'assistant', content: answer });
    const cap = cfg().agent.historyMessages * 2;
    if (session.messages.length > cap) session.messages.splice(0, session.messages.length - cap);
  }

  /**
   * If the caller introduces a different identity (new email or a different
   * name), forget the previous caller's account facts so we never answer
   * about the wrong account.
   */
  private rememberEntities(session: Session, entities: Record<string, string>) {
    const f = session.facts;
    const newEmail = entities.email && f.email && entities.email !== f.email;
    const newName = entities.name && f.name && !f.name.toLowerCase().includes(entities.name.toLowerCase().split(' ')[0]);
    if (newEmail || newName) {
      for (const k of ['email', 'name', 'plan', 'invoice_id', 'last_refund', 'last_ticket']) delete f[k];
      session.verifiedEmail = undefined;
    }
    for (const [k, v] of Object.entries(entities)) f[k] = v;
  }

  // ------------------------------------------------------------------ citations

  private citedSources(answer: string, ctx: TurnContext): Source[] {
    const out: Source[] = [];
    for (const id of extractCitationIds(answer)) {
      const src = ctx.retrieved.get(id) ?? this.findInHistory(ctx.session, id);
      if (src) out.push(src);
    }
    return out;
  }

  /** A follow-up answer may re-cite a source retrieved in an earlier turn. */
  private findInHistory(session: Session, id: string): Source | undefined {
    for (let i = session.transcript.length - 1; i >= 0; i--) {
      const hit = session.transcript[i].sources?.find((s) => s.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Remove citation markers that point at nothing, so the transcript stays honest. */
  private cleanReply(answer: string, ctx: TurnContext): string {
    return filterCitations(answer, (id) => ctx.retrieved.has(id) || Boolean(this.findInHistory(ctx.session, id)));
  }
}

const GROUNDING_LABEL: Record<Grounding, string> = {
  grounded: 'grounded',
  partial: 'partly supported',
  insufficient: 'not covered by knowledge base',
  tools_only: 'from tools',
  not_needed: 'no retrieval needed',
};

const INTENT_ALIASES: Record<string, Intent> = {
  question: 'knowledge_question',
  knowledge: 'knowledge_question',
  policy_question: 'knowledge_question',
  account: 'account_request',
  billing: 'account_request',
  refund_request: 'account_request',
  action_request: 'account_request',
  ticket_request: 'account_request',
  technical_issue: 'troubleshooting',
  greeting: 'small_talk',
  chitchat: 'small_talk',
  thanks: 'small_talk',
};

function toIntent(raw: unknown): Intent {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((INTENTS as string[]).includes(v)) return v as Intent;
  return INTENT_ALIASES[v] ?? 'unknown';
}

function sanitizeEntities(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of ['email', 'name', 'invoice_id', 'plan']) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim() && !/^(null|unknown|n\/a|none)$/i.test(v.trim())) {
      out[key] = key === 'email' ? v.trim().toLowerCase().replace(/\s+/g, '') : key === 'invoice_id' ? v.trim().toUpperCase().replace(/\s+/g, '') : v.trim();
    }
  }
  return out;
}

function mergeSources(a: Source[], b: Source[]): Source[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).sort((x, y) => y.score - x.score);
}

function isSource(s: Source | undefined): s is Source {
  return Boolean(s);
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
