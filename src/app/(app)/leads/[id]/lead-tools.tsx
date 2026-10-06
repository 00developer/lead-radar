'use client';

import { useEffect, useRef, useState } from 'react';
import { btn, btnPrimary, input } from '../../../../components/ui';
import { SubmitButton } from '../../../../components/submit-button';

/** Reply draft: editable, saved on request, with a copy button. The tool never sends anything. */
export function ReplyBox({ leadId, initial, save }: { leadId: string; initial: string; save: (f: FormData) => Promise<void> }) {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      // Clipboard can be refused: select the text so Ctrl+C works.
      area.current?.select();
      setCopied('no');
    }
    setTimeout(() => setCopied(null), 2500);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey) void copy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <form action={save} className="grid gap-2">
      <input type="hidden" name="id" value={leadId} />
      <label className="text-sm font-medium" htmlFor="reply">
        Reply draft <span className="font-normal text-(--muted)">(not sent automatically)</span>
      </label>
      <textarea id="reply" name="reply" ref={area} value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} className={input} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} onClick={copy}>
          Copy reply (C)
        </button>
        <SubmitButton className={btn} pendingLabel="Saving…">
          Save edit
        </SubmitButton>
        <span aria-live="polite" className="text-sm text-(--muted)">
          {copied === 'yes' && 'Copied.'}
          {copied === 'no' && 'Could not copy automatically. The text is selected, press Ctrl+C.'}
        </span>
      </div>
    </form>
  );
}

/** Keyboard shortcuts on the lead page: 1 to 6 set the status, g / n set the review label. */
export function Shortcuts({ statusForms }: { statusForms: string[] }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const idx = '123456'.indexOf(e.key);
      const id = idx >= 0 ? statusForms[idx] : e.key === 'g' ? 'label-genuine' : e.key === 'n' ? 'label-not' : null;
      if (!id) return;
      const form = document.getElementById(id) as HTMLFormElement | null;
      form?.requestSubmit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [statusForms]);
  return null;
}
