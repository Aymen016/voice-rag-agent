import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { cfg } from '../config';
import { KbService } from './kb.service';

@Controller('kb')
export class KbController {
  constructor(private readonly kb: KbService) {}

  /** Standalone semantic search, used by the UI's search inspector. */
  @Get('search')
  async search(@Query('q') q?: string, @Query('k') k?: string) {
    if (!q?.trim()) throw new BadRequestException('Query parameter "q" is required');
    const t0 = Date.now();
    // minScore 0 so the inspector shows the full ranking, including weak matches.
    const results = await this.kb.search(q, k ? Number(k) : 5, 0);
    const { minScore, sufficientScore } = cfg().kb;
    return {
      query: q,
      tookMs: Date.now() - t0,
      thresholds: { minScore, sufficientScore },
      results,
    };
  }

  @Get('documents')
  documents() {
    return this.kb.listDocuments();
  }

  @Get('documents/:id')
  async document(@Param('id') id: string) {
    const doc = await this.kb.getDocument(id);
    if (!doc) throw new NotFoundException();
    return doc;
  }
}
