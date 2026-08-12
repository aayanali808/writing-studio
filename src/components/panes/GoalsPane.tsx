'use client';

import { useStudio } from '@/components/studio/StudioContext';

const STATUS_LABELS: Record<string, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

/**
 * Goals for the piece.
 *
 * Free text on purpose — audience, argument, deadline, tone, things to avoid.
 * Whatever is here goes into the Context Bundle verbatim and shapes every AI
 * response, so it is closer to a standing instruction than a checklist.
 */
export function GoalsPane() {
  const { goals, setGoals, goalsStatus } = useStudio();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
          Sent with every AI request
        </span>
      </header>

      <textarea
        value={goals}
        onChange={(event) => setGoals(event.target.value)}
        placeholder={
          'What is this piece for?\n\n· 1,500-word essay for a general audience\n· Argue that X, without overclaiming\n· Plain voice — no jargon, no bulleted lists'
        }
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-relaxed outline-none placeholder:text-[var(--text-faint)]"
      />

      <footer className="border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
        <span className={goalsStatus === 'error' ? 'text-[var(--danger)]' : undefined}>
          {STATUS_LABELS[goalsStatus] ?? ''}
        </span>
      </footer>
    </div>
  );
}
