import { Injectable, Logger } from '@nestjs/common';
import { cfg } from '../config';

// transformers.js ships as ESM. This keeps TypeScript from rewriting the
// dynamic import into require() when compiling to CommonJS.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;

/**
 * Turns text into dense vectors for semantic search.
 *
 * Default: all-MiniLM-L6-v2 running locally through transformers.js (ONNX).
 * Free, offline after the first download, and deterministic, which keeps the
 * index reproducible for reviewers. An OpenAI-compatible /embeddings API can be
 * used instead by setting EMBEDDINGS_PROVIDER=api.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private extractorPromise: Promise<any> | null = null;

  get modelId(): string {
    const c = cfg().embeddings;
    return c.provider === 'api' ? `api:${c.apiModel}` : `local:${c.localModel}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return cfg().embeddings.provider === 'api' ? this.embedViaApi(texts) : this.embedLocally(texts);
  }

  async embedOne(text: string): Promise<number[]> {
    const [v] = await this.embed([text]);
    return v;
  }

  private getExtractor(): Promise<any> {
    if (!this.extractorPromise) {
      const { localModel, cacheDir } = cfg().embeddings;
      this.extractorPromise = (async () => {
        this.logger.log(`Loading local embedding model ${localModel} (first run downloads it, about 25 MB)...`);
        const { pipeline, env } = await dynamicImport('@huggingface/transformers');
        env.cacheDir = cacheDir;
        const extractor = await pipeline('feature-extraction', localModel, { dtype: 'fp32' });
        this.logger.log('Embedding model ready');
        return extractor;
      })().catch((err) => {
        this.extractorPromise = null;
        throw err;
      });
    }
    return this.extractorPromise;
  }

  private async embedLocally(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const out: number[][] = [];
    const batchSize = 16;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      out.push(...(tensor.tolist() as number[][]));
    }
    return out;
  }

  private async embedViaApi(texts: string[]): Promise<number[][]> {
    const { apiBaseUrl, apiKey, apiModel } = cfg().embeddings;
    const out: number[][] = [];
    const batchSize = 64;
    for (let i = 0; i < texts.length; i += batchSize) {
      const res = await fetch(`${apiBaseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: apiModel, input: texts.slice(i, i + batchSize) }),
      });
      if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${await res.text()}`);
      const json: any = await res.json();
      const vectors = (json.data as any[])
        .sort((a, b) => a.index - b.index)
        .map((d) => normalize(d.embedding as number[]));
      out.push(...vectors);
    }
    return out;
  }
}

export function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Cosine similarity for unit vectors (a dot product). */
export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
