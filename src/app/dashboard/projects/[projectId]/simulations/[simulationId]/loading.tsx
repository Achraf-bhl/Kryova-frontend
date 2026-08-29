import { SkeletonGrid } from "@/components/skeleton";
import { PageShell } from "@/components/ui/page-shell";

export default function SimulationLoading() {
  return (
    <PageShell>
      <SkeletonGrid count={4} />
    </PageShell>
  );
}
