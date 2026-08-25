"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { AgentChat } from "@/components/agent-chat";

const EXAMPLES = [
  "A steel mounting bracket that carries a 40 kg motor",
  "An aluminium drone arm, clamped at the hub",
  "A cantilever beam I want to check for yielding",
];

export default function NewProjectChat() {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(null);

  const handleProjectCreated = useCallback(
    (id: string) => {
      setProjectId(id);
      // Refresh so the project list behind this page is already correct when
      // the user goes back, without yanking them out of the conversation.
      router.refresh();
    },
    [router],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {projectId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
          <p className="text-sm text-muted">
            Your project is created. Keep going here, or open it to upload geometry.
          </p>
          <Link
            href={`/dashboard/projects/${projectId}`}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Open project
          </Link>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <AgentChat
          title="New project"
          subtitle="Describe the part you want to analyse. I'll set it up with you."
          placeholder="What are you analysing?"
          examples={EXAMPLES}
          autoFocus
          onProjectCreated={handleProjectCreated}
        />
      </div>
    </div>
  );
}
