import { SkeletonCard } from "@/components/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <SkeletonLine className="h-8 w-48" />
        <SkeletonLine className="mt-2 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-4 w-full animate-pulse rounded bg-border/60 ${className}`} />;
}
