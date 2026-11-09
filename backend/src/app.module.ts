import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './agent/agent.controller';
import { AgentService } from './agent/agent.service';
import { SessionStore } from './agent/session.store';
import { CrmService } from './tools/crm.service';
import { ToolRegistry } from './tools/tool.registry';
import { EmbeddingsService } from './embeddings/embeddings.service';
import { HealthController } from './health.controller';
import { KbController } from './kb/kb.controller';
import { KbService } from './kb/kb.service';
import { LlmService } from './llm/llm.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] })],
  controllers: [HealthController, KbController, AgentController],
  providers: [EmbeddingsService, KbService, LlmService, CrmService, ToolRegistry, SessionStore, AgentService],
})
export class AppModule {}
