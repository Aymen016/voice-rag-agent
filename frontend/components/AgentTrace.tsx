'use client';

import { useState } from 'react';
import { Brain, CheckCircle2, ChevronRight, MessageSquareText, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import type { AgentStep } from '@/lib/types';

const ICON = {
  intent: Brain,
  tool: Wrench,
  thought: MessageSquareText,
  verify: ShieldCheck,
  answer: CheckCircle2,
  error: XCircle,
};

export function AgentTrace({ steps }: { steps: AgentStep[] }) {
  const toolCount = steps.filter((s) => s.kind === 'tool').length;
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-ink-700/70 bg-ink-900/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-300 hover:text-ink-100"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="font-medium">Agent trace</span>
        <span className="text-ink-400">
          {steps.length} steps · {toolCount} tool call{toolCount === 1 ? '' : 's'}
        </span>
        <span className="ml-auto flex gap-1">
          {steps
            .filter((s) => s.kind === 'tool')
            .map((s, i) => (
              <span key={i} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${s.ok === false ? 'bg-ember/15 text-ember' : 'bg-ink-800 text-ink-300'}`}>
                {s.title}
              </span>
            ))}
        </span>
      </button>
      {open && (
        <ol className="space-y-2 border-t border-ink-700/70 px-3 py-3">
          {steps.map((s, i) => (
            <StepRow key={i} step={s} index={i + 1} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({ step, index }: { step: AgentStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICON[step.kind] ?? Wrench;
  const hasDetail = step.input !== undefined || step.output !== undefined;

  return (
    <li className="text-xs">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-[10px] text-ink-400">{String(index).padStart(2, '0')}</span>
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${step.ok === false ? 'text-ember' : step.kind === 'tool' ? 'text-signal' : 'text-ink-300'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-medium ${step.kind === 'tool' ? 'font-mono text-signal' : 'text-ink-100'}`}>{step.title}</span>
            {step.ms !== undefined && <span className="font-mono text-[10px] text-ink-400">{step.ms} ms</span>}
          </div>
          {step.summary && <p className="mt-0.5 break-words text-ink-300">{step.summary}</p>}
          {hasDetail && (
            <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-[11px] text-ink-400 underline-offset-2 hover:text-ink-100 hover:underline">
              {expanded ? 'Hide' : 'Show'} {step.kind === 'tool' ? 'arguments and result' : 'details'}
            </button>
          )}
          {expanded && (
            <div className="mt-1.5 space-y-1.5">
              {step.input !== undefined && <Json label="input" value={step.input} />}
              {step.output !== undefined && <Json label="output" value={step.output} />}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <pre className="scrollbar-thin max-h-64 overflow-auto rounded-md bg-ink-950 p-2 font-mono text-[11px] leading-relaxed text-ink-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
