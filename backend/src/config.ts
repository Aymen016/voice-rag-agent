import * as path from 'path';

/**
 * Central, lazily-read configuration. Read on every call so values loaded by
 * @nestjs/config (from .env) are always picked up.
 */
export function cfg() {
  const env = process.env;
  const llmBaseUrl = (env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/+$/, '');

  return {
    port: Number(env.PORT ?? 4000),
    // Max agent turns per IP per minute (protects the LLM key).
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 20),
    corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),

    llm: {
      baseUrl: llmBaseUrl,
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? 'openai/gpt-oss-120b',
      temperature: Number(env.LLM_TEMPERATURE ?? 0.2),
      timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 45000),
      // Sent as reasoning_effort. Defaults to "low" for gpt-oss models only;
      // set LLM_REASONING_EFFORT=none to never send it.
      reasoningEffort: resolveReasoningEffort(env.LLM_REASONING_EFFORT, env.LLM_MODEL ?? 'openai/gpt-oss-120b'),
    },

    embeddings: {
      provider: (env.EMBEDDINGS_PROVIDER ?? 'local') as 'local' | 'api',
      localModel: env.EMBEDDINGS_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
      apiBaseUrl: (env.EMBEDDINGS_API_BASE_URL ?? llmBaseUrl).replace(/\/+$/, ''),
      apiKey: env.EMBEDDINGS_API_KEY ?? env.LLM_API_KEY ?? '',
      apiModel: env.EMBEDDINGS_API_MODEL ?? 'gemini-embedding-001',
      cacheDir: path.resolve(env.MODEL_CACHE_DIR ?? '.cache/models'),
    },

    kb: {
      dir: path.resolve(env.KB_DIR ?? '../knowledge-base'),
      indexPath: path.resolve(env.INDEX_PATH ?? '.cache/index.json'),
      topK: Number(env.SEARCH_TOP_K ?? 4),
      minScore: Number(env.SEARCH_MIN_SCORE ?? 0.25),
      sufficientScore: Number(env.SEARCH_SUFFICIENT_SCORE ?? 0.4),
    },

    agent: {
      maxSteps: Number(env.AGENT_MAX_STEPS ?? 6),
      historyMessages: Number(env.AGENT_HISTORY_MESSAGES ?? 12),
      // Hard budget for one turn; stays below the frontend proxy timeout.
      turnTimeoutMs: Number(env.AGENT_TURN_TIMEOUT_MS ?? 75000),
      // Second-pass grounding check of each knowledge-base answer.
      verify: (env.AGENT_VERIFY ?? 'true') !== 'false',
    },
  };
}

function resolveReasoningEffort(value: string | undefined, model: string): string | undefined {
  if (value === 'none' || value === '') return undefined;
  if (value) return value;
  return /gpt-oss/i.test(model) ? 'low' : undefined;
}

export type AppConfig = ReturnType<typeof cfg>;
