import { SkeletonCard, SkeletonLine } from "@/components/skeleton";
import { PageShell } from "@/components/ui/page-shell";

export default function ProjectLoading() {
  return (
    <PageShell className="flex flex-col gap-8">
      <SkeletonLine className="h-8 w-64" />
      <SkeletonCard />
      <SkeletonCard />
    </PageShell>
  );
}
