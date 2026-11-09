import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { cfg } from '../config';
import { EmbeddingsService, cosine } from '../embeddings/embeddings.service';
import { KbChunk, KbDocument, chunkDocument, parseDocument } from './chunker';

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

interface IndexFile {
  fingerprint: string;
  model: string;
  chunks: (KbChunk & { vector: number[] })[];
}

/**
 * Loads the markdown knowledge base, chunks it, embeds every chunk and keeps an
 * in-memory vector index. Embeddings are cached on disk keyed by a fingerprint
 * of (model + chunk text), so restarts are instant and edits re-index
 * automatically.
 *
 * A flat in-memory index is the right call at this size (tens of chunks):
 * exact search, zero infrastructure, sub-millisecond queries. The interface
 * (search -> ranked hits with scores) is what a pgvector/Qdrant backend would
 * implement for a larger corpus.
 */
@Injectable()
export class KbService implements OnModuleInit {
  private readonly logger = new Logger(KbService.name);
  private documents: KbDocument[] = [];
  private chunks: (KbChunk & { vector: number[] })[] = [];
  private ready = false;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly embeddings: EmbeddingsService) {}

  onModuleInit() {
    // Build in the background so the HTTP server starts immediately.
    this.ensureReady().catch((err) => this.logger.error(`Indexing failed: ${err.message}`, err.stack));
  }

  get isReady() {
    return this.ready;
  }
  get documentCount() {
    return this.documents.length;
  }
  get chunkCount() {
    return this.chunks.length;
  }
  get embeddingModel() {
    return this.embeddings.modelId;
  }

  ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.buildIndex().catch((err) => {
        this.readyPromise = null;
        throw err;
      });
    }
    return this.readyPromise;
  }

  private async buildIndex() {
    const { dir, indexPath } = cfg().kb;
    const files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.md')).sort();
    if (files.length === 0) throw new Error(`No .md files found in ${dir}`);

    this.documents = await Promise.all(
      files.map(async (f) => parseDocument(f, await fs.readFile(path.join(dir, f), 'utf8'))),
    );
    const chunks = this.documents.flatMap(chunkDocument);
    const model = this.embeddings.modelId;
    const fingerprint = createHash('sha1')
      .update(model)
      .update(chunks.map((c) => c.embedText).join('\u0000'))
      .digest('hex');

    const cached = await this.readIndex(indexPath);
    if (cached && cached.fingerprint === fingerprint) {
      this.chunks = cached.chunks;
      this.logger.log(`Loaded cached index: ${this.documents.length} documents, ${this.chunks.length} chunks`);
    } else {
      this.logger.log(`Embedding ${chunks.length} chunks from ${this.documents.length} documents...`);
      const t0 = Date.now();
      const vectors = await this.embeddings.embed(chunks.map((c) => c.embedText));
      this.chunks = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      const file: IndexFile = { fingerprint, model, chunks: this.chunks };
      await fs.writeFile(indexPath, JSON.stringify(file));
      this.logger.log(`Index built in ${Date.now() - t0} ms and cached to ${indexPath}`);
    }
    this.ready = true;
  }

  private async readIndex(p: string): Promise<IndexFile | null> {
    try {
      return JSON.parse(await fs.readFile(p, 'utf8')) as IndexFile;
    } catch {
      return null;
    }
  }

  /**
   * Semantic search: embed the query, rank every chunk by cosine similarity.
   * Returns the top `k` hits at or above `minScore`, best first.
   */
  async search(query: string, k = cfg().kb.topK, minScore = cfg().kb.minScore): Promise<SearchHit[]> {
    if (!query?.trim()) return [];
    try {
      await this.ensureReady();
    } catch (err: any) {
      throw new ServiceUnavailableException(`Knowledge base index is not available: ${err.message}`);
    }
    const qv = await this.embeddings.embedOne(query.trim());
    return this.chunks
      .map((c) => ({ c, score: cosine(qv, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .filter((x) => x.score >= minScore)
      .slice(0, Math.max(1, Math.min(k, 20)))
      .map(({ c, score }, i) => ({
        chunkId: c.id,
        docId: c.docId,
        document: c.docTitle,
        file: c.file,
        section: c.section,
        text: c.text,
        score: Math.round(score * 1000) / 1000,
        rank: i + 1,
      }));
  }

  async listDocuments() {
    await this.ensureReady();
    return this.documents.map((d) => ({
      id: d.id,
      file: d.file,
      title: d.title,
      sections: this.chunks.filter((c) => c.docId === d.id).map((c) => c.section),
      chunks: this.chunks.filter((c) => c.docId === d.id).length,
    }));
  }

  async getDocument(id: string) {
    await this.ensureReady();
    return this.documents.find((d) => d.id === id) ?? null;
  }
}
