"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import type { DesignSummary, Member } from "@/types/api";
import type { ConversationSummary } from "@/types/conversation";

/**
 * The rest of what a project holds, in one place (ROAD_TO_10 7.3): its conversations, its
 * designs with the technical-file download, and the people with a role in it.
 *
 * Geometry, simulations, memory, sharing and the CATIA panel are already sections of
 * `project-content.tsx` and are not repeated. **Requirements coverage and drawings are not
 * here**: neither is stored per project on the server (a `.kreq` is parsed and reported per
 * conversation, drawings are produced on demand), so a section would have nothing to read
 * and would say "none" about something that merely was not asked. They arrive with the
 * backend that stores them.
 *
 * Each section loads on its own and fails on its own: a project page whose member list
 * cannot be read still shows its designs.
 */
type Load<T> = { kind: "loading" } | { kind: "ready"; items: T[] } | { kind: "failed"; message: string };

function useLoaded<T>(fetcher: () => Promise<T[]>, key: string): Load<T> {
  const [state, setState] = useState<{ key: string; load: Load<T> }>({
    key,
    load: { kind: "loading" },
  });
  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((items) => {
        if (!cancelled) setState({ key, load: { kind: "ready", items } });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            key,
            load: {
              kind: "failed",
              message: error instanceof ApiError ? error.message : "Could not load this.",
            },
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // The fetcher is rebuilt every render; the key is what says the question changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.load : { kind: "loading" };
}

function Section<T>({
  title,
  load,
  empty,
  children,
}: {
  title: string;
  load: Load<T>;
  empty: string;
  children: (items: T[]) => React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="rounded-lg bg-surface shadow-card">
        {load.kind === "loading" && <p className="px-5 py-4 text-sm text-muted">Loading…</p>}
        {load.kind === "failed" && <p className="px-5 py-4 text-sm text-danger">{load.message}</p>}
        {load.kind === "ready" &&
          (load.items.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">{empty}</p>
          ) : (
            children(load.items)
          ))}
      </div>
    </section>
  );
}

export interface ProjectOverviewProps {
  projectId: string;
  organisationId: string;
}

export function ProjectOverview({ projectId, organisationId }: ProjectOverviewProps) {
  const conversations = useLoaded<ConversationSummary>(
    async () => (await api.listProjectConversations(projectId)).items,
    `c:${projectId}`,
  );
  const designs = useLoaded<DesignSummary>(
    async () => (await api.listProjectDesigns(projectId)).items,
    `d:${projectId}`,
  );
  const members = useLoaded<Member>(
    async () => (await api.listMembers(organisationId)).items,
    `m:${organisationId}`,
  );
  const [downloadFailure, setDownloadFailure] = useState<string | null>(null);

  async function technicalFile(design: DesignSummary) {
    setDownloadFailure(null);
    try {
      const blob = await api.technicalFileBlob(design.conversation_id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${design.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "design"}-r${design.revision_number}-technical-file.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadFailure(
        error instanceof ApiError ? error.message : "Could not download the technical file.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Conversations" load={conversations} empty="No conversation in this project yet.">
        {(items) => (
          <ul className="divide-y divide-border">
            {items.map((conversation) => (
              <li key={conversation.conversation_id}>
                <Link
                  href={`/dashboard/c/${conversation.conversation_id}`}
                  className="flex items-center justify-between px-5 py-3 text-sm hover:bg-canvas/50"
                >
                  <span className="truncate">{conversation.title}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {conversation.message_count} messages
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Designs" load={designs} empty="No design has been saved in this project yet.">
        {(items) => (
          <ul className="divide-y divide-border">
            {items.map((design) => (
              <li key={design.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <Link
                  href={`/dashboard/c/${design.conversation_id}`}
                  className="truncate hover:text-primary"
                >
                  {design.name}{" "}
                  <span className="font-mono text-xs text-muted">r{design.revision_number}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void technicalFile(design)}
                  className="shrink-0 text-xs text-primary hover:underline"
                >
                  Technical file
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {downloadFailure && <p className="-mt-6 text-sm text-danger">{downloadFailure}</p>}

      <Section title="People" load={members} empty="No members.">
        {(items) => (
          <ul className="divide-y divide-border">
            {items.map((member) => (
              <li
                key={member.user_id}
                className="flex items-center justify-between px-5 py-3 text-sm"
              >
                <span>{member.email}</span>
                <span className="text-xs text-muted">{member.role}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
