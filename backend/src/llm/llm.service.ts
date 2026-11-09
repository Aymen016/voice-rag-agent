import { GatewayTimeoutException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { cfg } from '../config';
import { ChatMessage, ChatOptions } from './llm.types';

/**
 * Minimal client for any OpenAI-compatible /chat/completions endpoint
 * (Groq, Gemini's OpenAI layer, OpenRouter, OpenAI, local Ollama...).
 *
 * Written on plain fetch rather than a vendor SDK so swapping providers is a
 * .env change. Handles the realities of free tiers: 429 rate limits (respects
 * Retry-After), transient 5xx, timeouts, and the occasional malformed tool
 * call some open models produce.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  get isConfigured() {
    return Boolean(cfg().llm.apiKey);
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatMessage> {
    const { baseUrl, apiKey, model, temperature, timeoutMs, reasoningEffort } = cfg().llm;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'LLM_API_KEY is not set. Add a free Groq or Gemini key to backend/.env and restart the backend.',
      );
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? temperature,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    // Reasoning models (gpt-oss) think before answering. "low" keeps voice
    // turns fast; the hard decisions live in tools and prompts anyway.
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = opts.toolChoice ?? 'auto';
    }
    if (opts.json) body.response_format = { type: 'json_object' };

    const maxAttempts = 4;
    let lastError = '';
    let rateLimited = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = opts.deadline ? opts.deadline - Date.now() : Infinity;
      if (remaining < 1500) break;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (res.ok) {
          const json: any = await res.json();
          const msg = json?.choices?.[0]?.message;
          if (!msg) throw new Error(`Malformed LLM response: ${JSON.stringify(json).slice(0, 300)}`);
          return {
            role: 'assistant',
            content: typeof msg.content === 'string' ? msg.content : null,
            tool_calls: Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls : undefined,
          };
        }

        const text = await res.text();
        lastError = `LLM ${res.status}: ${text.slice(0, 500)}`;

        if (res.status === 401 || res.status === 403) {
          throw new ServiceUnavailableException('The LLM provider rejected the API key. Check LLM_API_KEY in backend/.env.');
        }
        if (res.status === 429 || res.status >= 500) {
          rateLimited = res.status === 429;
          const wait = this.retryDelayMs(res.headers.get('retry-after'), attempt);
          const left = opts.deadline ? opts.deadline - Date.now() : Infinity;
          if (wait > left - 2000 || attempt === maxAttempts) break; // not worth waiting past the budget
          this.logger.warn(`${lastError.slice(0, 160)} -> retrying in ${wait} ms (attempt ${attempt}/${maxAttempts})`);
          await sleep(wait);
          continue;
        }
        // Some open models occasionally emit an invalid tool call; the provider
        // rejects it with a 400. A plain retry almost always succeeds.
        if (res.status === 400 && /tool_use_failed|failed to call a function|tool call validation/i.test(text) && attempt < maxAttempts) {
          this.logger.warn('Provider rejected a malformed tool call, retrying');
          body.temperature = 0;
          continue;
        }
        throw new Error(lastError);
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          lastError = `LLM request timed out`;
          continue;
        }
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timer);
      }
    }
    if (rateLimited) {
      throw new HttpException(
        'The free LLM tier is rate-limiting requests right now. Wait about 20 seconds and ask again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw new GatewayTimeoutException(lastError ? `The language model did not answer in time (${lastError.slice(0, 120)}).` : 'The language model did not answer in time.');
  }

  /** Ask for a JSON object and parse it defensively. */
  async chatJson<T = any>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<T> {
    try {
      const msg = await this.chat(messages, { ...opts, json: true });
      return parseJsonLoose<T>(msg.content ?? '');
    } catch (err: any) {
      // Some models/providers reject JSON mode or return an empty body; retry
      // once in plain mode and parse the JSON out of the text.
      if (err instanceof HttpException) throw err;
      this.logger.warn(`JSON mode failed (${String(err?.message).slice(0, 120)}), retrying without it`);
      const msg = await this.chat(messages, opts);
      return parseJsonLoose<T>(msg.content ?? '');
    }
  }

  private retryDelayMs(retryAfter: string | null, attempt: number): number {
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(seconds)) return Math.min(20000, Math.max(500, seconds * 1000));
    return Math.min(15000, 1000 * 2 ** (attempt - 1));
  }
}

export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error(`Could not parse JSON from model output: ${trimmed.slice(0, 200)}`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
