import { Injectable } from '@nestjs/common';
import { Source, TurnContext } from '../agent/agent.types';
import { cfg } from '../config';
import { KbService } from '../kb/kb.service';
import { ToolSpec } from '../llm/llm.types';
import { CrmService, Customer, FIRST_RESPONSE_TARGET, PlanId, daysSince } from './crm.service';

export interface ToolOutcome {
  ok: boolean;
  result: unknown; // sent back to the LLM
  summary: string; // one line for the agent trace in the UI
}

interface AgentTool {
  spec: ToolSpec;
  run(args: Record<string, any>, ctx: TurnContext): Promise<ToolOutcome>;
}

const CONSENT_RE = /\b(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|do that|open|create|raise|file|ticket|escalate)\b/i;

const REFUND_REASONS = ['duplicate_charge', 'not_satisfied', 'downgrade', 'service_outage', 'other'] as const;

/**
 * The agent's tools. Each tool has a JSON-schema spec the LLM sees and an
 * implementation that validates its own arguments. Errors are returned to the
 * model as data (not thrown) so it can recover: ask the user, retry, or
 * explain.
 */
@Injectable()
export class ToolRegistry {
  private readonly tools: Record<string, AgentTool>;

  constructor(private readonly kb: KbService, private readonly crm: CrmService) {
    this.tools = {
      search_knowledge_base: this.searchKnowledgeBase(),
      get_customer_account: this.getCustomerAccount(),
      calculate_refund: this.calculateRefund(),
      check_service_status: this.checkServiceStatus(),
      create_support_ticket: this.createSupportTicket(),
    };
  }

  specs(): ToolSpec[] {
    return Object.values(this.tools).map((t) => t.spec);
  }

  async execute(name: string, rawArgs: string, ctx: TurnContext): Promise<ToolOutcome & { args: Record<string, any> }> {
    const tool = this.tools[name];
    let args: Record<string, any> = {};
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      return { ok: false, args: {}, summary: `Invalid JSON arguments for ${name}`, result: { error: 'Arguments were not valid JSON. Call the tool again with a valid JSON object.' } };
    }
    if (!tool) {
      return { ok: false, args, summary: `Unknown tool ${name}`, result: { error: `Unknown tool "${name}". Available: ${Object.keys(this.tools).join(', ')}` } };
    }
    try {
      return { ...(await tool.run(args ?? {}, ctx)), args };
    } catch (err: any) {
      return { ok: false, args, summary: `${name} failed: ${err.message}`, result: { error: err.message } };
    }
  }

  /** Register a KB hit as a citable source for this turn (reusing ids for the same chunk). */
  private register(ctx: TurnContext, h: { chunkId: string; document: string; file: string; section: string; score: number; text: string }): Source {
    const existing = [...ctx.retrieved.values()].find((s) => s.chunkId === h.chunkId);
    if (existing) return existing;
    const source: Source = { id: `S${++ctx.session.sourceCounter}`, chunkId: h.chunkId, document: h.document, file: h.file, section: h.section, score: h.score, text: h.text };
    ctx.retrieved.set(source.id, source);
    return source;
  }

  /** Did the caller mention this account's email name or first name in this conversation? */
  private callerNamed(ctx: TurnContext, c: Customer): boolean {
    const said = [...ctx.session.transcript.filter((t) => t.role === 'user').map((t) => t.text), ctx.userText ?? '']
      .join(' ')
      .toLowerCase();
    const local = c.email.split('@')[0];
    const first = c.name.split(' ')[0].toLowerCase();
    return said.includes(local) || said.includes(first) || said.includes(c.email);
  }

  /** Refunds and tickets only for the account looked up for the current caller. */
  private requireCurrentCaller(ctx: TurnContext, c: Customer): ToolOutcome | null {
    if (ctx.session.verifiedEmail === c.email) return null;
    return {
      ok: false,
      summary: 'Blocked: not the current caller\'s account',
      result: { error: "This is not the account of the current caller. Call get_customer_account with the caller's own email first." },
    };
  }

  private fact(ctx: TurnContext, line: string) {
    (ctx.toolFacts ??= []).push(line);
  }

  // ---------------------------------------------------------------- tools

  private searchKnowledgeBase(): AgentTool {
    return {
      spec: {
        type: 'function',
        function: {
          name: 'search_knowledge_base',
          description:
            'Semantic search over CloudNest help center documents (plans, pricing, billing, refunds, security, sync, sharing, deleted files, storage limits, support SLAs, privacy). ' +
            'Returns ranked passages with source ids and similarity scores plus an "assessment" of whether they are good enough to answer. ' +
            'Use a focused query describing the underlying topic, not the whole conversation.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query, e.g. "refund for duplicate charge"' },
              top_k: { type: 'integer', description: 'Number of passages to return (1-6). Default 4.' },
            },
            required: ['query'],
          },
        },
      },
      run: async (args, ctx) => {
        const query = String(args.query ?? '').trim();
        if (!query) return { ok: false, summary: 'Empty query', result: { error: 'query is required' } };
        const k = Math.min(6, Math.max(1, Number(args.top_k) || cfg().kb.topK));
        const { sufficientScore } = cfg().kb;
        const hits = await this.kb.search(query, k);
        const top = hits[0]?.score ?? 0;
        const assessment: 'sufficient' | 'weak' | 'none' = !hits.length ? 'none' : top >= sufficientScore ? 'sufficient' : 'weak';
        ctx.searches.push({ query, assessment, topScore: top });

        const results = hits.map((h) => {
          const src = this.register(ctx, h);
          return { source_id: src.id, document: h.document, section: h.section, score: h.score, text: h.text };
        });

        const guidance = {
          sufficient: 'Passages look relevant. Answer only from them and cite source ids like [S1]. If they do not actually contain the specific fact asked about, say so.',
          weak: 'Matches are weak. Try ONE more search with different wording or the underlying concept. If still weak, tell the user the help center does not cover it; do not guess.',
          none: 'Nothing relevant found. Try ONE rephrased search; if still nothing, tell the user you do not have reliable information on this.',
        }[assessment];

        return {
          ok: true,
          summary: `${hits.length} passages, top score ${top.toFixed(2)} (${assessment})`,
          result: { query, assessment, top_score: top, guidance, results },
        };
      },
    };
  }

  private getCustomerAccount(): AgentTool {
    return {
      spec: {
        type: 'function',
        function: {
          name: 'get_customer_account',
          description:
            "Look up the caller's CloudNest account: plan, billing cycle, status, storage usage, region and recent invoices. " +
            'Provide the email (preferred) or the full name. Spoken emails like "sara at example dot com" are accepted.',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Account email address' },
              name: { type: 'string', description: 'Full name on the account, if no email is known' },
            },
          },
        },
      },
      run: async (args, ctx) => {
        if (!args.email && !args.name) {
          return { ok: false, summary: 'No email or name given', result: { error: 'Ask the customer for the email address on the account.' } };
        }
        const { customer, candidates } = this.crm.findCustomer({ email: args.email, name: args.name });
        if (!customer) {
          return {
            ok: false,
            summary: candidates ? `Ambiguous name (${candidates.length} matches)` : 'No matching account',
            result: candidates
              ? { found: false, message: 'Several accounts match that name. Ask for the email address.' }
              : { found: false, message: 'No account found. Ask the customer to confirm the email address (spell it out).' },
          };
        }
        // Only look up accounts the caller themselves named. This stops the
        // model (or text injected via a document or tool result) from pulling
        // up someone else's account data.
        if (!this.callerNamed(ctx, customer)) {
          return {
            ok: false,
            summary: 'Blocked: caller never named this account',
            result: { found: false, message: 'You can only look up the account the customer has identified themselves with in this conversation. Ask for their email.' },
          };
        }
        ctx.session.verifiedEmail = customer.email;
        // Remember who we are talking to so follow-ups never re-ask.
        ctx.session.facts.email = customer.email;
        ctx.session.facts.name = customer.name;
        ctx.session.facts.plan = `${customer.plan}${customer.cycle ? ` (${customer.cycle})` : ''}`;
        this.fact(ctx, `Account ${customer.email}: ${customer.name}, ${customer.plan} ${customer.cycle ?? ''} plan, ${customer.seats} seat(s), region ${customer.region}, storage ${customer.storageUsedGb}/${customer.storageLimitGb} GB, invoices ${customer.invoices.map((i) => `${i.invoiceId} ${i.date} $${i.amount}${i.duplicateOf ? ' (duplicate of ' + i.duplicateOf + ')' : ''}`).join('; ') || 'none'}`);
        return {
          ok: true,
          summary: `${customer.name}: ${customer.plan}${customer.cycle ? ' ' + customer.cycle : ''}, ${customer.invoices.length} invoices`,
          result: { found: true, account: this.publicAccount(customer) },
        };
      },
    };
  }

  private calculateRefund(): AgentTool {
    return {
      spec: {
        type: 'function',
        function: {
          name: 'calculate_refund',
          description:
            'Apply the official refund policy to one invoice and return eligibility and the exact amount. ' +
            'Does NOT move money; refunds are processed by the billing team via a ticket. Call get_customer_account first to get invoice ids.',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Account email' },
              invoice_id: { type: 'string', description: 'Invoice id, e.g. INV-1043' },
              reason: { type: 'string', enum: [...REFUND_REASONS], description: 'Why the customer wants a refund' },
            },
            required: ['email', 'invoice_id', 'reason'],
          },
        },
      },
      run: async (args, ctx) => {
        const { customer } = this.crm.findCustomer({ email: args.email });
        if (!customer) return { ok: false, summary: 'Account not found', result: { error: 'No account with that email. Look the account up first.' } };
        const denied = this.requireCurrentCaller(ctx, customer);
        if (denied) return denied;
        const reason = REFUND_REASONS.includes(args.reason) ? (args.reason as (typeof REFUND_REASONS)[number]) : 'other';
        const inv = customer.invoices.find((i) => i.invoiceId.toLowerCase() === String(args.invoice_id ?? '').toLowerCase().replace(/\s+/g, ''));
        if (!inv) {
          return { ok: false, summary: 'Invoice not found', result: { error: `Invoice not found. Valid invoices: ${customer.invoices.map((i) => i.invoiceId).join(', ') || 'none'}` } };
        }
        ctx.session.facts.invoice_id = inv.invoiceId;

        const age = daysSince(inv.date);
        const base = { invoice_id: inv.invoiceId, invoice_date: inv.date, days_since_charge: age, amount_paid: inv.amount, currency: 'USD', reason };
        let decision: { eligible: boolean; refund_amount: number; rule: string; notes: string; service_credit?: number };

        if (inv.status === 'refunded') {
          decision = { eligible: false, refund_amount: 0, rule: 'Already refunded', notes: 'This invoice has already been refunded.' };
        } else if (reason === 'duplicate_charge') {
          decision = inv.duplicateOf
            ? age <= 120
              ? { eligible: true, refund_amount: inv.amount, rule: 'Duplicate charges are refunded in full within 120 days', notes: `Duplicate of ${inv.duplicateOf}. Does not use the cooling-off allowance.` }
              : { eligible: false, refund_amount: 0, rule: 'Duplicate charges must be reported within 120 days', notes: 'Reported too late.' }
            : { eligible: false, refund_amount: 0, rule: 'Duplicate charge not confirmed', notes: 'No second charge for the same period was found for this invoice. Check the other invoice id.' };
        } else if (reason === 'service_outage') {
          decision =
            customer.plan === 'business'
              ? { eligible: false, refund_amount: 0, service_credit: Math.round(inv.amount * 0.1 * 100) / 100, rule: 'Outages earn service credits (10% of the month) for Business, not refunds', notes: 'Credit is applied to the next invoice via a billing ticket.' }
              : { eligible: false, refund_amount: 0, rule: 'Outages do not qualify for refunds; only Business has an uptime commitment', notes: '' };
        } else if (age <= 14) {
          decision = { eligible: true, refund_amount: inv.amount, rule: 'Full refund within 14 days of the charge (cooling-off period)', notes: '' };
        } else if (inv.cycle === 'annual' && age <= 30) {
          const usedMonths = Math.ceil(age / 30);
          const unused = 12 - usedMonths;
          const amount = Math.round(((inv.amount * unused) / 12) * 100) / 100;
          decision = { eligible: true, refund_amount: amount, rule: 'Annual plans: prorated refund for unused full months between day 15 and 30', notes: `${unused} unused months of 12.` };
        } else {
          decision = {
            eligible: false,
            refund_amount: 0,
            rule: inv.cycle === 'annual' ? 'Annual charges older than 30 days are not refundable' : 'Monthly charges older than 14 days are not refundable',
            notes: 'The customer can cancel to stop the next renewal and keeps access until the paid period ends.',
          };
        }

        // Ground the decision: attach the policy passage the rule comes from,
        // so refund answers are citable even if the model skips its own search.
        const [policy] = await this.kb.search(`refund policy: ${decision.rule}`, 1).catch(() => []);
        const policySource = policy ? this.register(ctx, policy) : null;

        const payout = decision.eligible ? 'Original payment method, 5 to 10 business days after the billing team approves it' : null;
        if (decision.eligible) ctx.session.facts.last_refund = `$${decision.refund_amount} for ${inv.invoiceId} (${reason}), eligible`;
        this.fact(ctx, `Refund calculation for ${inv.invoiceId} (${reason}, ${age} days old, paid $${inv.amount}): ${decision.eligible ? `eligible for $${decision.refund_amount}` : 'not eligible'}. Rule: ${decision.rule}. ${decision.notes} ${payout ? 'Payout: ' + payout + '.' : ''}`);

        return {
          ok: true,
          summary: decision.eligible ? `Eligible: $${decision.refund_amount} for ${inv.invoiceId}` : `Not eligible (${decision.rule})`,
          result: {
            ...base,
            ...decision,
            payout,
            policy_source: policySource ? { source_id: policySource.id, document: policySource.document, section: policySource.section } : null,
          },
        };
      },
    };
  }

  private checkServiceStatus(): AgentTool {
    return {
      spec: {
        type: 'function',
        function: {
          name: 'check_service_status',
          description: 'Get live CloudNest service status and ongoing incidents (sync, web_app, sharing, api). Use for "not working", "slow", "not syncing" problems.',
          parameters: {
            type: 'object',
            properties: { component: { type: 'string', enum: ['all', 'sync', 'web_app', 'sharing', 'api'] } },
          },
        },
      },
      run: async (args, ctx) => {
        const all = this.crm.serviceStatus();
        const comp = args.component && args.component !== 'all' ? all.filter((c) => c.component === args.component) : all;
        const issues = comp.filter((c) => c.status !== 'operational');
        for (const c of comp) this.fact(ctx, `Service status ${c.component}: ${c.status}${'incident' in c && c.incident ? ' - ' + c.incident : ''}`);
        return {
          ok: true,
          summary: issues.length ? issues.map((i) => `${i.component}: ${i.status}`).join(', ') : 'All operational',
          result: { components: comp },
        };
      },
    };
  }

  private createSupportTicket(): AgentTool {
    return {
      spec: {
        type: 'function',
        function: {
          name: 'create_support_ticket',
          description:
            'Open a support ticket for a human team (billing refunds, technical issues, account recovery). ' +
            'Only call after the customer asked for it or agreed. Include all relevant details (invoice ids, refund amount, symptoms) in the description.',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              category: { type: 'string', enum: ['billing', 'technical', 'account', 'other'] },
              priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
              subject: { type: 'string', description: 'Short subject line' },
              description: { type: 'string', description: 'Full details for the human agent' },
            },
            required: ['email', 'category', 'subject', 'description'],
          },
        },
      },
      run: async (args, ctx) => {
        const { customer } = this.crm.findCustomer({ email: args.email });
        if (!customer) return { ok: false, summary: 'Account not found', result: { error: 'Tickets need a valid account email. Ask the customer for it.' } };
        const denied = this.requireCurrentCaller(ctx, customer);
        if (denied) return denied;
        // Side effect: require the caller's agreement in their own words this
        // turn, enforced in code rather than trusted to the prompt.
        if (ctx.userText !== undefined && !CONSENT_RE.test(ctx.userText)) {
          return {
            ok: false,
            summary: 'Blocked: customer has not agreed to a ticket this turn',
            result: { error: 'Do not open a ticket yet. Offer it and wait for the customer to agree.' },
          };
        }
        const category = ['billing', 'technical', 'account', 'other'].includes(args.category) ? args.category : 'other';
        const priority = ['low', 'normal', 'high', 'urgent'].includes(args.priority) ? args.priority : 'normal';
        const ticket = this.crm.createTicket(
          { email: customer.email, category, priority, subject: String(args.subject ?? 'Support request').slice(0, 140), description: String(args.description ?? '').slice(0, 2000) },
          customer.plan,
        );
        ctx.session.facts.last_ticket = ticket.ticketId;
        this.fact(ctx, `Ticket ${ticket.ticketId} ${ticket.deduplicated ? 'already existed' : 'created'} for ${customer.email} (${category}, ${priority}); first response ${ticket.expectedFirstResponse}`);
        return {
          ok: true,
          summary: ticket.deduplicated ? `Reused open ${ticket.ticketId} (duplicate request)` : `Created ${ticket.ticketId} (${category}, ${priority})`,
          result: ticket.deduplicated
            ? { created: false, already_open: true, ticket, note: 'A matching ticket was opened minutes ago; tell the customer it is already open instead of creating another.' }
            : { created: true, ticket },
        };
      },
    };
  }

  private publicAccount(c: Customer) {
    return {
      name: c.name,
      email: c.email,
      plan: c.plan,
      billing_cycle: c.cycle,
      seats: c.seats,
      status: c.status,
      member_since: c.signupDate,
      storage: { used_gb: c.storageUsedGb, limit_gb: c.storageLimitGb, percent_used: Math.round((c.storageUsedGb / c.storageLimitGb) * 1000) / 10 },
      data_region: c.region,
      support_first_response_target: FIRST_RESPONSE_TARGET[c.plan as PlanId],
      recent_invoices: c.invoices.map((i) => ({
        invoice_id: i.invoiceId,
        date: i.date,
        days_ago: daysSince(i.date),
        amount_usd: i.amount,
        description: i.description,
        status: i.status,
        ...(i.duplicateOf ? { flagged: `same amount and period as ${i.duplicateOf}` } : {}),
      })),
    };
  }
}
