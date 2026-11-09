import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { cfg } from './config';
import { rateLimit } from './rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: cfg().corsOrigin });
  app.use(
    rateLimit([
      { prefix: '/api/agent/chat', max: cfg().rateLimitPerMinute, windowMs: 60_000 },
      { prefix: '/api/', max: 300, windowMs: 60_000 },
    ]),
  );
  await app.listen(cfg().port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${cfg().port}/api`);
  if (!cfg().llm.apiKey) {
    logger.warn('LLM_API_KEY is empty. Semantic search works, but the agent will return 503 until a key is set in backend/.env');
  }
}

bootstrap();
