import { BadGatewayException, BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpException, NotFoundException, Param, Post } from '@nestjs/common';
import { CrmService } from '../tools/crm.service';
import { ToolRegistry } from '../tools/tool.registry';
import { AgentService } from './agent.service';

interface ChatBody {
  sessionId?: string;
  message?: string;
}

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly tools: ToolRegistry,
    private readonly crm: CrmService,
  ) {}

  /** One conversational turn. The frontend sends the speech-to-text transcript here. */
  @Post('chat')
  @HttpCode(200)
  async chat(@Body() body: ChatBody) {
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) throw new BadRequestException('"message" is required');
    try {
      return await this.agent.handleTurn(body.sessionId, message);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadGatewayException(`The language model request failed: ${err?.message ?? err}`);
    }
  }

  @Get('sessions/:id')
  session(@Param('id') id: string) {
    const s = this.agent.getSession(id);
    if (!s) throw new NotFoundException('Session not found (the server may have restarted)');
    // busy = a turn is still running (e.g. the page was reloaded mid-answer).
    return { sessionId: s.id, facts: s.facts, busy: this.agent.isBusy(s.id), turns: s.transcript };
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  reset(@Param('id') id: string) {
    return { reset: this.agent.resetSession(id) };
  }

  /** Tool catalogue as the LLM sees it. */
  @Get('tools')
  listTools() {
    return this.tools.specs().map((t) => t.function);
  }

  /** Tickets created by the agent during this server run (demo visibility). */
  @Get('tickets')
  tickets() {
    return this.crm.listTickets();
  }

  /** Sample accounts reviewers can use in the demo. */
  @Get('demo-accounts')
  demoAccounts() {
    return this.crm.listCustomers();
  }
}
