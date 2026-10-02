export default function Loading() {
  return (
    <div className="mt-6 grid gap-3" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-(--neutral-bg)" />
      ))}
    </div>
  );
}
