export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-4 w-full animate-pulse rounded bg-border/60 ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
      <SkeletonLine />
      <SkeletonLine />
      <SkeletonLine className="w-1/2" />
    </div>
  );
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg bg-surface p-4 shadow-card">
          <SkeletonLine className="w-2/3" />
          <div className="mt-3 h-6 animate-pulse rounded bg-border/60" />
        </div>
      ))}
    </div>
  );
}
