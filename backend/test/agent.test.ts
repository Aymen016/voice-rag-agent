/**
 * Offline tests (no API key, no network): text clean-up, tools and refund
 * rules against the mock CRM, and full agent turns driven by a scripted fake
 * LLM (multi-step tools, citations, memory, caller switch, failure paths).
 *
 *   npm test
 */
import 'reflect-metadata';
import { normalizeModelText, extractCitationIds, filterCitations, toSpeech } from '../src/agent/text';
import { CrmService } from '../src/tools/crm.service';
import { ToolRegistry } from '../src/tools/tool.registry';
import { SessionStore } from '../src/agent/session.store';
import { AgentService } from '../src/agent/agent.service';
import { rateLimit } from '../src/rate-limit';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`); };

// ---------- 1. text helpers on real outputs from your test run
const zw = 'try these [​S23​] and refresh [​S25​].';
const n = normalizeModelText(zw);
ok('zero-width citations are recognised', JSON.stringify(extractCitationIds(n)) === '["S23","S25"]', extractCitationIds(n));
ok('glued citations [S9][S6] split', JSON.stringify(extractCitationIds(normalizeModelText('history panel [S9][S6].'))) === '["S9","S6"]');
ok('CJK brackets 【S1】 recognised', extractCitationIds(normalizeModelText('fourteen days 【S1】.'))[0] === 'S1');
ok('unknown citations removed', filterCitations('A [S1] B [S99].', (id) => id === 'S1') === 'A [S1] B.', filterCitations('A [S1] B [S99].', (id) => id === 'S1'));
const sp = toSpeech(normalizeModelText('Invoice INV‑1043 refunded [S11]. Ticket CN‑83409. 1. Make sure you are online. 2. Pull down to refresh. Go to Settings → Billing.'));
ok('speech: no citations', !/S11/.test(sp), sp);
ok('speech: invoice read once as words', /Invoice 1043/i.test(sp) && !/invoice invoice/i.test(sp), sp);
ok('speech: ticket id spelled', /C N 8 3 4 0 9/.test(sp), sp);
ok('speech: list numbers removed', !/\b1\.\s|\b2\.\s/.test(sp), sp);
console.log('      speech text:', sp);

// ---------- 2. tools against the mock CRM (fake KB)
const fakeKb: any = { search: async (q: string) => [{ chunkId: 'refund#5', docId: '03', document: 'Refund and Cancellation Policy', file: '03.md', section: 'Duplicate charges', text: 'Duplicate charges are refunded in full within 120 days.', score: 0.75, rank: 1 }] };
const crm = new CrmService();
const tools = new ToolRegistry(fakeKb, crm);
const sessions = new SessionStore();
const mkCtx = (userText?: string) => ({ session: sessions.getOrCreate('test-tools-1'), userText, retrieved: new Map(), searches: [] as any[] });
/** Simulate the caller saying something, so account guards see it. */
const say = (ctx: any, text: string) => ctx.session.transcript.push({ id: String(Math.random()), role: 'user', text, at: '' });

(async () => {
  let ctx: any = mkCtx();
  let r: any = await tools.execute('get_customer_account', JSON.stringify({ email: 'maria@example.com' }), ctx);
  ok('GUARD: cannot look up an account the caller never named', !r.ok && /Blocked/.test(r.summary), r.summary);
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'maria@example.com', invoice_id: 'INV-3310', reason: 'other' }), ctx);
  ok('GUARD: no refund calculation for an account not looked up', !r.ok && /Blocked/.test(r.summary), r.summary);

  say(ctx, 'I am Sara at simple dot com');
  r = await tools.execute('get_customer_account', JSON.stringify({ email: 'Sara at simple dot com' }), ctx);
  ok('spoken + misheard email finds Sara', r.ok && r.result.account.name === 'Sara Khan', r.summary);
  r = await tools.execute('get_customer_account', JSON.stringify({ name: 'Jennifer' }), ctx);
  ok('unknown name -> not found (no guessing)', !r.ok && r.result.found === false, r.summary);
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'sara@example.com', invoice_id: 'INV-1043', reason: 'duplicate_charge' }), ctx);
  ok('Sara duplicate charge -> full $12', r.result.eligible && r.result.refund_amount === 12, r.result);
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'sara@example.com', invoice_id: 'INV-0987', reason: 'not_satisfied' }), ctx);
  ok('Sara 34-day-old monthly -> not eligible', r.result.eligible === false, r.result);
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'sara@example.com', invoice_id: 'INV-9999', reason: 'other' }), ctx);
  ok('bad invoice id -> helpful error', !r.ok && /Valid invoices/.test(r.result.error), r.result);

  ctx.userText = 'tell me the status';
  r = await tools.execute('create_support_ticket', JSON.stringify({ email: 'sara@example.com', category: 'billing', subject: 'Refund', description: 'INV-1043 duplicate' }), ctx);
  ok('GUARD: no ticket unless the caller agreed this turn', !r.ok && /agreed/.test(r.summary), r.summary);
  ctx.userText = 'yes please open a ticket for dad';
  r = await tools.execute('create_support_ticket', JSON.stringify({ email: 'sara@example.com', category: 'billing', subject: 'Refund', description: 'INV-1043 duplicate' }), ctx);
  ok('ticket created with Pro SLA after consent', /^CN-\d{5}$/.test(r.result.ticket?.ticketId) && r.result.ticket.expectedFirstResponse === 'within 24 hours', r.result);
  r = await tools.execute('create_support_ticket', JSON.stringify({ email: 'sara@example.com', category: 'billing', subject: 'Again', description: 'retry' }), ctx);
  ok('same ticket requested twice -> deduplicated, not a second ticket', r.result.already_open === true && crm.listTickets().length === 1, r.summary);
  r = await tools.execute('create_support_ticket', JSON.stringify({ email: 'ali@example.com', category: 'billing', subject: 'x', description: 'x' }), ctx);
  ok("GUARD: no ticket on someone else's account", !r.ok && /Blocked/.test(r.summary), r.summary);

  say(ctx, 'this is ali at example dot com');
  await tools.execute('get_customer_account', JSON.stringify({ email: 'ali@example.com' }), ctx);
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'ali@example.com', invoice_id: 'INV-2001', reason: 'not_satisfied' }), ctx);
  ok('Ali annual day 20 -> prorated $528', r.result.eligible && r.result.refund_amount === 528, r.result);
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'sara@example.com', invoice_id: 'INV-1043', reason: 'duplicate_charge' }), ctx);
  ok('GUARD: after switching to Ali, Sara account actions are blocked', !r.ok && /Blocked/.test(r.summary), r.summary);

  say(ctx, 'now maria at example dot com');
  await tools.execute('get_customer_account', JSON.stringify({ email: 'maria@example.com' }), ctx);
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'maria@example.com', invoice_id: 'INV-3310', reason: 'not_satisfied' }), ctx);
  ok('Maria annual day 41 -> not eligible', r.result.eligible === false, r.result);

  r = await tools.execute('check_service_status', '{"component":"sync"}', ctx);
  ok('status shows EU sync degraded', /degraded/.test(r.summary), r.summary);
  r = await tools.execute('nope', '{}', ctx);
  ok('unknown tool handled', !r.ok);
  r = await tools.execute('search_knowledge_base', '{bad json', ctx);
  ok('bad JSON args handled', !r.ok);

  ctx = mkCtx();
  say(ctx, 'sara here');
  await tools.execute('get_customer_account', JSON.stringify({ email: 'sara@example.com' }), ctx);
  ctx.retrieved = new Map();
  r = await tools.execute('calculate_refund', JSON.stringify({ email: 'sara@example.com', invoice_id: 'INV-1043', reason: 'duplicate_charge' }), ctx);
  ok('refund tool attaches its policy passage as a citable source', r.result.policy_source?.source_id && ctx.retrieved.size === 1, r.result.policy_source);
  ok('refund tool records facts for the verifier and memory', (ctx.toolFacts ?? []).some((f: string) => /eligible for \$12/.test(f)) && /\$12 for INV-1043/.test(ctx.session.facts.last_refund ?? ''));

  // ---------- 3. full agent turns with a scripted LLM
  const script: any[] = [];
  const seen: any[][] = [];
  const fakeLlm: any = {
    chatJson: async () => script.shift(),
    chat: async (messages: any[]) => { seen.push(messages); return script.shift(); },
  };
  const agent = new AgentService(fakeLlm, tools, sessions);
  const call = (id: string, name: string, args: object) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const analysis = (o: object = {}) => ({ intent: 'account_request', is_follow_up: false, standalone_query: 'q', entities: {}, planned_actions: [], missing_info: [], ...o });
  const lastSystem = () => seen[seen.length - 1][0].content as string;

  // Turn 1: scenario 3 (multi-step), model cites one real and one fake source
  script.push(
    analysis({ entities: { email: 'sara@example.com' } }),
    call('c1', 'get_customer_account', { email: 'sara at example dot com' }),
    call('c2', 'search_knowledge_base', { query: 'refund duplicate charge' }),
    call('c3', 'calculate_refund', { email: 'sara@example.com', invoice_id: 'INV-1043', reason: 'duplicate_charge' }),
    { role: 'assistant', content: 'You are eligible for a full $12 refund of INV‑1043 [​S1​] [S77]. Shall I open a ticket?' },
    { verdict: 'supported', supported_source_ids: ['S1'], unsupported_claims: [] },
  );
  let t: any = await agent.handleTurn('demo-session-1', 'I am sara at example dot com, charged twice for Pro, money back?');
  ok('turn 1: 3 tools in order', t.steps.filter((s: any) => s.kind === 'tool').map((s: any) => s.title).join('>') === 'get_customer_account>search_knowledge_base>calculate_refund');
  ok('turn 1: verifier ran and answer is grounded', t.grounding === 'grounded' && t.steps.some((s: any) => s.kind === 'verify'), t.grounding);
  ok('turn 1: fake citation S77 stripped', !/S77/.test(t.reply), t.reply);
  ok('turn 1: speech has no brackets', !/\[/.test(t.speech), t.speech);

  // Turn 2: "ticket for dad" -> agent already knows email, invoice and refund amount
  script.push(
    analysis({ intent: 'Ticket Request', is_follow_up: true }),
    call('c4', 'create_support_ticket', { email: 'sara@example.com', category: 'technical', subject: 'Duplicate charge', description: 'Refund INV-1043, $12' }),
    { role: 'assistant', content: 'Done, your ticket is CN‑12345.' },
  );
  t = await agent.handleTurn('demo-session-1', 'please open a ticket for dad');
  ok('turn 2: memory carries email, invoice and refund amount', /email: sara@example\.com/.test(lastSystem()) && /invoice_id: INV-1043/.test(lastSystem()) && /last_refund: \$12/.test(lastSystem()));
  ok('turn 2: intent alias "Ticket Request" mapped', t.intent === 'account_request', t.intent);
  ok('turn 2: no KB used -> "from tools", verifier skipped', t.grounding === 'tools_only' && !t.steps.some((s: any) => s.kind === 'verify'), t.grounding);
  const stored = sessions.get('demo-session-1')!.messages;
  ok('memory is compact: no old tool payloads replayed', stored.every((m: any) => m.role === 'user' || m.role === 'assistant') && stored.length === 4, stored.map((m: any) => m.role));

  // Turn 3: model forgets to cite, verifier attributes the source anyway
  script.push(
    analysis({ intent: 'knowledge_question' }),
    call('c5', 'search_knowledge_base', { query: 'duplicate charge refund' }),
    { role: 'assistant', content: 'Duplicate charges are refunded in full within 120 days.' },
    { verdict: 'supported', supported_source_ids: ['S2'], unsupported_claims: [] },
  );
  t = await agent.handleTurn('demo-session-1', 'how long do I have to report a double charge');
  ok('turn 3: uncited answer still gets its source via the verifier', t.grounding === 'grounded' && t.sources.length === 1, { g: t.grounding, n: t.sources.length });

  // Turn 4: overclaim ("we don't offer") -> partial + unsupported claim shown
  script.push(
    analysis({ intent: 'knowledge_question' }),
    call('c6', 'search_knowledge_base', { query: 'student discount' }),
    { role: 'assistant', content: "Nonprofits get 30% off Business, and we don't offer a student discount." },
    { verdict: 'partially_supported', supported_source_ids: ['S3'], unsupported_claims: ["we don't offer a student discount"] },
  );
  t = await agent.handleTurn('demo-session-1', 'student discount?');
  ok('turn 4: overclaim flagged as partly supported', t.grounding === 'partial' && t.turn.unsupportedClaims.length === 1, t.grounding);

  // Turn 5: caller switch to Ali -> Sara facts dropped
  script.push(analysis({ entities: { email: 'ali@example.com' } }), { role: 'assistant', content: 'Let me check.' });
  await agent.handleTurn('demo-session-1', 'different account, ali at example dot com');
  const known = lastSystem().split('KNOWN CONTEXT')[1] ?? '';
  ok('turn 5: new caller in memory, previous invoice/refund forgotten', /ali@example\.com/.test(known) && !/INV-1043|last_refund/.test(known), known);

  // Turn 6: analyzer fails -> turn still works
  script.push(undefined, { role: 'assistant', content: 'Hi! How can I help?' });
  t = await agent.handleTurn('demo-session-1', 'hello');
  ok('turn 6: analyzer failure does not break the turn', t.reply === 'Hi! How can I help?' && t.grounding === 'not_needed');

  // Turn 7: model keeps calling tools -> forced final answer at max steps
  script.push(analysis({ intent: 'troubleshooting' }));
  for (let i = 0; i < 5; i++) script.push(call('l' + i, 'check_service_status', {}));
  script.push({ role: 'assistant', content: 'Sync is degraded in the EU.' });
  t = await agent.handleTurn('demo-session-1', 'why is sync broken');
  ok('turn 7: loop capped at max steps and still answers', t.reply === 'Sync is degraded in the EU.' && t.steps.filter((s: any) => s.kind === 'tool').length === 5);

  // Turn 8: two requests at once on one session run one after another
  const order: string[] = [];
  const slowLlm: any = {
    chatJson: async () => analysis({ intent: 'small_talk' }),
    chat: async (m: any[]) => { const q = m[m.length - 1].content; order.push('start:' + q); await new Promise((r) => setTimeout(r, 30)); order.push('end:' + q); return { role: 'assistant', content: 'ok ' + q }; },
  };
  const agent2 = new AgentService(slowLlm, tools, sessions);
  await Promise.all([agent2.handleTurn('race-session-1', 'A'), agent2.handleTurn('race-session-1', 'B')]);
  ok('concurrent turns on one session are serialized', order.join(',') === 'start:A,end:A,start:B,end:B', order);

  // Turn 9: a failing turn leaves an error entry (so a reloaded page stops waiting)
  const badLlm: any = { chatJson: async () => analysis(), chat: async () => { throw new Error('boom'); } };
  const agent3 = new AgentService(badLlm, tools, sessions);
  await agent3.handleTurn('fail-session-1', 'hi').catch(() => undefined);
  const ft = sessions.get('fail-session-1')!.transcript;
  ok('failed turn is recorded as an error, not left pending', ft.length === 2 && ft[1].error === true);

  // ---------- 4. API rate limiting
  const limiter = rateLimit([{ prefix: '/api/agent/chat', max: 3, windowMs: 60_000 }]);
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    let status = 200;
    const res: any = { status: (c: number) => { status = c; return res; }, setHeader: () => {}, json: () => {} };
    limiter({ ip: '1.2.3.4', originalUrl: '/api/agent/chat' }, res, () => {});
    codes.push(status);
  }
  ok('rate limiter: 4th request in a minute gets 429', codes.join(',') === '200,200,200,429,429', codes);
  let otherPassed = false;
  limiter({ ip: '5.6.7.8', originalUrl: '/api/agent/chat' }, { status: () => ({}) } as any, () => { otherPassed = true; });
  ok('rate limiter: other users are not affected', otherPassed);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
