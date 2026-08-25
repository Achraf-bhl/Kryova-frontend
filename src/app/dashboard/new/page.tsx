import Link from "next/link";

import NewProjectChat from "./_components/new-project-chat";

export const dynamic = "force-dynamic";

export default function NewProjectPage() {
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Start a project</h1>
          <p className="mt-1 text-sm text-muted">
            Tell the assistant what you are building. It creates the project and
            walks you through geometry, loads and material.
          </p>
        </div>
        <Link href="/dashboard" className="shrink-0 text-sm text-muted hover:text-accent">
          Cancel
        </Link>
      </div>

      <div className="min-h-0 flex-1">
        <NewProjectChat />
      </div>
    </div>
  );
}
