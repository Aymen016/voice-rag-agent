import { Injectable } from '@nestjs/common';

/**
 * Mock customer system (CRM + billing + status page + ticketing).
 * Stands in for the internal APIs a real support agent would call.
 * Dates are generated relative to "now" so the refund rules produce the same
 * outcomes whenever the reviewer runs the demo.
 */

export type PlanId = 'free' | 'pro' | 'business';
export type Cycle = 'monthly' | 'annual';

export interface Invoice {
  invoiceId: string;
  date: string; // YYYY-MM-DD
  amount: number; // USD
  plan: PlanId;
  cycle: Cycle;
  description: string;
  status: 'paid' | 'refunded' | 'failed';
  duplicateOf?: string;
}

export interface Customer {
  email: string;
  name: string;
  plan: PlanId;
  cycle: Cycle | null;
  seats: number;
  status: 'active' | 'trial' | 'past_due';
  signupDate: string;
  storageUsedGb: number;
  storageLimitGb: number;
  region: 'US' | 'EU';
  invoices: Invoice[];
}

export interface Ticket {
  ticketId: string;
  email: string;
  category: string;
  priority: string;
  subject: string;
  description: string;
  createdAt: string;
  expectedFirstResponse: string;
  deduplicated?: boolean;
}

export const FIRST_RESPONSE_TARGET: Record<PlanId, string> = {
  free: 'within 3 business days by email',
  pro: 'within 24 hours',
  business: 'within 4 business hours',
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function daysSince(isoDate: string): number {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((today - then) / 86_400_000);
}

function seed(): Customer[] {
  return [
    {
      email: 'sara@example.com',
      name: 'Sara Khan',
      plan: 'pro',
      cycle: 'monthly',
      seats: 1,
      status: 'active',
      signupDate: daysAgo(400),
      storageUsedGb: 612,
      storageLimitGb: 2048,
      region: 'EU',
      invoices: [
        { invoiceId: 'INV-1043', date: daysAgo(4), amount: 12, plan: 'pro', cycle: 'monthly', description: 'CloudNest Pro, monthly renewal', status: 'paid', duplicateOf: 'INV-1042' },
        { invoiceId: 'INV-1042', date: daysAgo(4), amount: 12, plan: 'pro', cycle: 'monthly', description: 'CloudNest Pro, monthly renewal', status: 'paid' },
        { invoiceId: 'INV-0987', date: daysAgo(34), amount: 12, plan: 'pro', cycle: 'monthly', description: 'CloudNest Pro, monthly renewal', status: 'paid' },
      ],
    },
    {
      email: 'ali@example.com',
      name: 'Ali Raza',
      plan: 'business',
      cycle: 'annual',
      seats: 3,
      status: 'active',
      signupDate: daysAgo(20),
      storageUsedGb: 2300,
      storageLimitGb: 15360,
      region: 'US',
      invoices: [
        { invoiceId: 'INV-2001', date: daysAgo(20), amount: 576, plan: 'business', cycle: 'annual', description: 'CloudNest Business, 3 seats, annual', status: 'paid' },
      ],
    },
    {
      email: 'maria@example.com',
      name: 'Maria Lopez',
      plan: 'pro',
      cycle: 'annual',
      seats: 1,
      status: 'active',
      signupDate: daysAgo(500),
      storageUsedGb: 140,
      storageLimitGb: 2048,
      region: 'US',
      invoices: [
        { invoiceId: 'INV-3310', date: daysAgo(41), amount: 120, plan: 'pro', cycle: 'annual', description: 'CloudNest Pro, annual renewal', status: 'paid' },
      ],
    },
    {
      email: 'john@example.com',
      name: 'John Doe',
      plan: 'free',
      cycle: null,
      seats: 1,
      status: 'active',
      signupDate: daysAgo(230),
      storageUsedGb: 4.96,
      storageLimitGb: 5,
      region: 'US',
      invoices: [],
    },
  ];
}

@Injectable()
export class CrmService {
  private customers: Customer[] = seed();
  private tickets: Ticket[] = [];

  /** Accepts emails mangled by speech-to-text, e.g. "sara at example dot com". */
  normalizeEmail(raw: string): string {
    return raw
      .toLowerCase()
      .trim()
      .replace(/\s+at\s+/g, '@')
      .replace(/\s+dot\s+/g, '.')
      .replace(/\s+/g, '')
      .replace(/\.$/, '');
  }

  findCustomer(query: { email?: string; name?: string }): { customer?: Customer; candidates?: string[] } {
    if (query.email) {
      const email = this.normalizeEmail(query.email);
      const hit = this.customers.find((c) => c.email === email);
      if (hit) return { customer: hit };
      // Speech-to-text often drops or adds a letter; match on the local part.
      const local = email.split('@')[0];
      const fuzzy = this.customers.filter((c) => c.email.split('@')[0] === local);
      if (fuzzy.length === 1) return { customer: fuzzy[0] };
    }
    if (query.name) {
      const q = query.name.toLowerCase().trim();
      const matches = this.customers.filter((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase().split(' ')[0]));
      if (matches.length === 1) return { customer: matches[0] };
      if (matches.length > 1) return { candidates: matches.map((m) => m.name) };
    }
    return {};
  }

  serviceStatus() {
    const since = new Date(Date.now() - 2 * 3600_000).toISOString();
    return [
      {
        component: 'sync',
        status: 'degraded',
        incident: 'Delayed sync for desktop clients in the EU region. Changes may take up to 30 minutes to appear on other devices. Engineers are working on a fix.',
        since,
        affectedRegions: ['EU'],
      },
      { component: 'web_app', status: 'operational' },
      { component: 'sharing', status: 'operational' },
      { component: 'api', status: 'operational' },
    ];
  }

  /**
   * Idempotent within 10 minutes: the same customer + category returns the
   * existing ticket. Protects against the agent (or a retried request)
   * opening duplicates.
   */
  createTicket(t: Omit<Ticket, 'ticketId' | 'createdAt' | 'expectedFirstResponse' | 'deduplicated'>, plan: PlanId): Ticket {
    const recent = this.tickets.find(
      (x) => x.email === t.email && x.category === t.category && Date.now() - new Date(x.createdAt).getTime() < 10 * 60_000,
    );
    if (recent) return { ...recent, deduplicated: true };
    const ticket: Ticket = {
      ...t,
      ticketId: `CN-${Math.floor(10000 + Math.random() * 90000)}`,
      createdAt: new Date().toISOString(),
      expectedFirstResponse: FIRST_RESPONSE_TARGET[plan],
    };
    this.tickets.unshift(ticket);
    return ticket;
  }

  listTickets() {
    return this.tickets;
  }

  listCustomers() {
    return this.customers.map((c) => ({ email: c.email, name: c.name, plan: c.plan, cycle: c.cycle }));
  }
}
