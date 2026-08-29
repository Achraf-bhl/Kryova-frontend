import { AgentChat } from "@/components/agent-chat";
import { PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return (
    <PageShell className="flex h-[calc(100dvh-4rem)] flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Assistant</h1>
        <p className="text-sm text-muted">
          It reads your projects, geometry and results itself — you can watch every
          step it takes.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <AgentChat />
      </div>
    </PageShell>
  );
}
