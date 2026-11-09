'use client';

import { Send } from 'lucide-react';

export const SCENARIOS: { label: string; shows: string; say: string }[] = [
  {
    label: '1. Voice + grounded answer',
    shows: 'Knowledge-grounded answer with sources',
    say: 'How long do I have to get a full refund after I pay?',
  },
  {
    label: '2. Semantic retrieval',
    shows: 'Wording differs from the docs ("throw away" vs "Recycle Bin")',
    say: 'What happens to stuff I throw away? Can I get it back?',
  },
  {
    label: '3. Agentic, multi-step',
    shows: 'Account lookup, policy search, refund calculation',
    say: "Hi, I'm sara at example dot com. I think I got charged twice for Pro this month. Can I get my money back?",
  },
  {
    label: '4. Contextual follow-up',
    shows: 'Reuses the email and invoice from the last turn',
    say: 'Yes please, open a ticket for that.',
  },
  {
    label: '5. Another follow-up',
    shows: 'Resolves "that" and "my plan" from memory',
    say: 'And how fast will someone reply on my plan?',
  },
  {
    label: '6. Insufficient information',
    shows: 'Retrieval evaluation: related but not answering, so it declines',
    say: 'Do you have a student discount?',
  },
  {
    label: '7. Troubleshooting (2 tools)',
    shows: 'Service status + troubleshooting docs',
    say: "My files aren't syncing to my phone. What's going on?",
  },
  {
    label: '8. Prorated refund',
    shows: 'Switches caller, prorated annual refund computed by a tool',
    say: "This is a different account, ali at example dot com. If I cancel my Business plan now, how much would I get back?",
  },
];

export function DemoScenarios({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs leading-relaxed text-ink-400">
        Say these out loud in order (best), or press the arrow to send the text. Scenarios 3 to 5 build on each other. Demo accounts:
        sara@, ali@, maria@, john@ example.com.
      </p>
      {SCENARIOS.map((s) => (
        <div key={s.label} className="rounded-lg border border-ink-700/70 bg-ink-900/60 p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-ink-100">{s.label}</div>
              <div className="mt-0.5 text-[11px] text-ink-400">{s.shows}</div>
              <div className="mt-1.5 text-[13px] italic leading-snug text-ink-300">“{s.say}”</div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSend(s.say)}
              title="Send as text"
              className="rounded-md p-1.5 text-ink-400 hover:bg-ink-800 hover:text-signal disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
