/**
 * End-to-end agent evaluation against the REAL LLM and knowledge base.
 *
 * Runs scripted conversations (the same scenarios as the demo) and checks
 * behaviour, not exact wording: which tools ran, grounding status, key facts
 * in the reply, and things that must NOT happen (asking for an email the
 * agent already has, overclaiming a policy, answering for the wrong caller).
 *
 *   npm run eval:agent            (uses LLM_API_KEY from .env)
 *   EVAL_PAUSE_MS=8000 npm run eval:agent   (slower, for strict free tiers)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AgentService } from '../agent/agent.service';
import { TurnResult } from '../agent/agent.types';
import { AppModule } from '../app.module';
import { KbService } from '../kb/kb.service';

interface Expect {
  tools?: string[]; // must all be called
  noTools?: string[]; // must not be called
  grounding?: string[]; // one of
  replyHas?: RegExp[];
  replyNot?: RegExp[];
}
interface Scenario {
  name: string;
  turns: { say: string; expect: Expect }[];
}

const SCENARIOS: Scenario[] = [
  {
    name: 'Grounded answer',
    turns: [{ say: 'How long do I have to get a full refund after I pay?', expect: { tools: ['search_knowledge_base'], grounding: ['grounded'], replyHas: [/14/] } }],
  },
  {
    name: 'Semantic retrieval (different wording)',
    turns: [{ say: 'What happens to stuff I throw away? Can I get it back?', expect: { tools: ['search_knowledge_base'], grounding: ['grounded'], replyHas: [/30/] } }],
  },
  {
    name: 'Multi-step refund + contextual follow-ups',
    turns: [
      {
        say: "Hi, I'm sara at example dot com. I think I got charged twice for Pro this month. Can I get my money back?",
        expect: { tools: ['get_customer_account', 'calculate_refund'], grounding: ['grounded', 'tools_only'], replyHas: [/12/] },
      },
      {
        say: 'Yes please, open a ticket for that.',
        expect: { tools: ['create_support_ticket'], replyHas: [/CN-?\s?\d|ticket/i], replyNot: [/what('| i)s your email|your email address/i] },
      },
      { say: 'And how fast will someone reply on my plan?', expect: { replyHas: [/24 hours/i], replyNot: [/which plan/i] } },
    ],
  },
  {
    name: 'Caller switch + prorated refund',
    turns: [
      { say: "Hi, I'm sara at example dot com.", expect: {} },
      {
        say: 'Actually this is a different account, ali at example dot com. If I cancel my Business plan now, how much would I get back?',
        expect: { tools: ['get_customer_account', 'calculate_refund'], replyHas: [/528/], replyNot: [/\$12\b/] },
      },
    ],
  },
  {
    name: 'Unknown caller is not guessed',
    turns: [{ say: "I'm Jennifer, how much would I get back if I cancel?", expect: { noTools: ['calculate_refund'], replyHas: [/email/i] } }],
  },
  {
    name: 'Insufficient information (no overclaim)',
    turns: [
      {
        say: 'Do you have a student discount?',
        expect: { grounding: ['insufficient', 'partial'], replyNot: [/we (do not|don't) (currently )?offer (a |any )?student/i] },
      },
    ],
  },
  {
    name: 'Answerable negative (explicitly in docs)',
    turns: [{ say: 'Can I pay with Bitcoin?', expect: { tools: ['search_knowledge_base'], grounding: ['grounded'], replyHas: [/crypto|bitcoin/i] } }],
  },
  {
    name: 'Troubleshooting uses two tools',
    turns: [{ say: "My files aren't syncing to my phone. What's going on?", expect: { tools: ['check_service_status', 'search_knowledge_base'] } }],
  },
  {
    name: 'Out of scope',
    turns: [{ say: "What's the weather in Lahore today?", expect: { noTools: ['get_customer_account', 'calculate_refund', 'create_support_ticket'], grounding: ['not_needed', 'insufficient'] } }],
  },
];

function check(r: TurnResult, e: Expect): string[] {
  const problems: string[] = [];
  const tools = r.steps.filter((s) => s.kind === 'tool').map((s) => s.title);
  for (const t of e.tools ?? []) if (!tools.includes(t)) problems.push(`missing tool ${t}`);
  for (const t of e.noTools ?? []) if (tools.includes(t)) problems.push(`should not call ${t}`);
  if (e.grounding && !e.grounding.includes(r.grounding)) problems.push(`grounding ${r.grounding}, expected ${e.grounding.join('/')}`);
  for (const re of e.replyHas ?? []) if (!re.test(r.reply)) problems.push(`reply lacks ${re}`);
  for (const re of e.replyNot ?? []) if (re.test(r.reply)) problems.push(`reply contains ${re}`);
  return problems;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pause = Number(process.env.EVAL_PAUSE_MS ?? 4000);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  await app.get(KbService).ensureReady();
  const agent = app.get(AgentService);

  let passed = 0;
  let total = 0;
  const latencies: number[] = [];
  for (const [i, sc] of SCENARIOS.entries()) {
    const sessionId = `eval-${Date.now()}-${i}`;
    console.log(`\n${sc.name}`);
    for (const turn of sc.turns) {
      total++;
      let line: string;
      try {
        const r = await agent.handleTurn(sessionId, turn.say);
        latencies.push(r.latencyMs);
        const problems = check(r, turn.expect);
        if (!problems.length) passed++;
        const tools = r.steps.filter((s) => s.kind === 'tool').map((s) => s.title).join(' > ') || '-';
        line = `  ${problems.length ? 'FAIL' : 'PASS'}  "${turn.say.slice(0, 60)}"\n        tools: ${tools} | ${r.grounding} | ${(r.latencyMs / 1000).toFixed(1)}s\n        reply: ${r.reply.slice(0, 160)}${problems.length ? `\n        problems: ${problems.join('; ')}` : ''}`;
      } catch (err: any) {
        line = `  ERROR "${turn.say.slice(0, 60)}": ${err?.message ?? err}`;
      }
      console.log(line);
      await sleep(pause); // stay under free-tier rate limits
    }
  }

  latencies.sort((a, b) => a - b);
  const p = (q: number) => (latencies.length ? (latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] / 1000).toFixed(1) : '-');
  console.log(`\n${passed}/${total} turns passed | latency p50 ${p(0.5)}s, p90 ${p(0.9)}s`);
  console.log('LLM output varies run to run; treat one or two failures as signal to inspect, not as flakes to ignore.');
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
