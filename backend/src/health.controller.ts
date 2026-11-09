import { Controller, Get } from '@nestjs/common';
import { cfg } from './config';
import { KbService } from './kb/kb.service';

@Controller('health')
export class HealthController {
  constructor(private readonly kb: KbService) {}

  @Get()
  health() {
    const c = cfg();
    return {
      status: 'ok',
      llm: { configured: Boolean(c.llm.apiKey), model: c.llm.model, baseUrl: c.llm.baseUrl },
      embeddings: { provider: c.embeddings.provider, model: this.kb.embeddingModel },
      knowledgeBase: { ready: this.kb.isReady, documents: this.kb.documentCount, chunks: this.kb.chunkCount },
    };
  }
}
