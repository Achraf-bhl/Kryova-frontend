import { SkeletonCard, SkeletonLine } from "@/components/skeleton";
import { PageShell } from "@/components/ui/page-shell";

export default function ProjectsLoading() {
  return (
    <PageShell className="flex flex-col gap-8">
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
    </PageShell>
  );
}
