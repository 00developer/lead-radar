'use client';

// Shows a stored UTC time in the viewer's own time zone. The server renders in UTC, so the browser
// re-renders the text after load; suppressHydrationWarning allows that one intended difference.

export function LocalTime({ value, dateOnly = false }: { value: string | Date | null | undefined; dateOnly?: boolean }) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {dateOnly ? d.toLocaleDateString() : d.toLocaleString()}
    </time>
  );
}
