import { MeshOrb } from "@/components/mesh-orb";

/**
 * The chat home while the session is being resolved.
 *
 * Shaped like the page it precedes — orb, greeting line, composer — so the
 * layout does not jump when the real thing arrives. The orb is the real
 * component rather than a grey box: it is the one element that is identical
 * before and after the data lands.
 */
export default function ChatHomeLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-end px-4 pb-5 sm:px-6">
      <MeshOrb className="h-28 w-28 opacity-70 sm:h-32 sm:w-32" />
      <div className="mt-7 h-9 w-64 animate-pulse rounded-md bg-border/60" />
      <div className="mt-3 h-7 w-52 animate-pulse rounded-md bg-border/40" />
      <div className="mt-8 h-28 w-full max-w-3xl animate-pulse rounded-xl bg-border/40" />
    </div>
  );
}
