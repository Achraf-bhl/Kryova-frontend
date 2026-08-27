import { SkeletonCard, SkeletonLine } from "@/components/skeleton";

export default function ProjectLoading() {
  return (
    <div className="flex flex-col gap-8">
      <SkeletonLine className="h-8 w-64" />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
