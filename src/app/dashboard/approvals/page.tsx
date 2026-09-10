import { PageShell } from "@/components/ui/page-shell";
import { ApprovalQueue } from "./_components/approval-queue";

export const dynamic = "force-dynamic";

/**
 * Approvals: sign-offs waiting on somebody, and the record of the ones already
 * made (P5.5).
 *
 * **A gate is a page, and that is the point of the phase task.** The
 * alternative — asking in the conversation and reading the answer back out of
 * it — loses in three ways: the transcript is trimmed, an LLM's paraphrase of
 * an approval is not an approval, and nobody can later answer "who signed this
 * off and what did they see". The last question is the one asked after
 * something goes wrong, which is the only time it matters.
 */
export default async function ApprovalsPage() {
  return (
    <PageShell className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Approvals</h1>
        <p className="max-w-prose text-sm text-muted">
          Decisions somebody has to make, with what they were shown recorded
          beside them. Approving needs the reviewer role, and an approval is
          pinned to the design as it was when the question was asked — if it has
          moved since, you will be asked to look again rather than sign for
          something nobody reviewed.
        </p>
      </div>
      <ApprovalQueue />
    </PageShell>
  );
}
