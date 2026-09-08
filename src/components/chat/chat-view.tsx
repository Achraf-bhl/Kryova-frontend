"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { activityLabel, AgentStepList } from "@/components/agent-step-list";
import { AttachPill } from "@/components/chat/attach-pill";
import { CatiaChip } from "@/components/chat/catia-chip";
import { Composer } from "@/components/chat/composer";
import { CopyButton } from "@/components/chat/copy-button";
import { ResumeNotice } from "@/components/chat/resume-notice";
import { MarkdownMessage } from "@/components/markdown-message";
import { KernelPartView } from "@/components/kernel-part-view";
import { MeshOrb } from "@/components/mesh-orb";
import { PartIcon } from "@/components/ui/icons";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { useCatiaStatus } from "@/hooks/use-catia-status";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { notifyConversationsChanged } from "@/lib/conversation-events";
import { resumeNotice } from "@/lib/conversation-resume";
import { kernelPartState } from "@/lib/kernel-render";
import type { Turn } from "@/lib/conversation-transcript";
import { toPlainText } from "@/lib/markdown";
import type { ConversationResume } from "@/types/conversation";

/**
 * Openers written the way an engineer would actually start.
 *
 * Not "summarise this" / "help me write" — the three things this product does,
 * phrased as instructions with real numbers in them, because the fastest way to
 * teach someone that the agent drives CATIA is to show them a sentence that
 * does.
 */
const SUGGESTIONS = [
  {
    label: "Start a part in CATIA",
    prompt: "Model a mounting bracket, 120 × 80 × 10 mm, with four M6 holes",
  },
  {
    label: "Set up an analysis",
    prompt: "Clamp the base, hang 40 kg off the top face, and run it",
  },
  {
    label: "Interpret a result",
    prompt: "Where is this part going to fail, and what should I thicken?",
  },
] as const;

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The clock is the external store here, and it never notifies. */
function subscribeNever(): () => void {
  return () => {};
}

function getGreeting(): string {
  return greetingFor(new Date());
}

function getServerGreeting(): string | null {
  return null;
}

/**
 * Whether this is running in the browser, as a store snapshot.
 *
 * Two booleans rather than the notice itself, because `getSnapshot` has to
 * return a cached value: `resumeNotice` builds a fresh object each call, and
 * returning that here makes React re-render forever looking for it to settle.
 * The notice is derived from this behind a `useMemo`.
 */
function getMounted(): boolean {
  return true;
}

function getServerMounted(): boolean {
  return false;
}

function firstNameOf(fullName: string | null, email: string): string {
  const trimmed = fullName?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return email.split("@")[0];
}

export interface ChatViewProps {
  fullName: string | null;
  email: string;
  /** Null on the chat home; the URL owns it everywhere else. */
  conversationId?: string | null;
  title?: string | null;
  initialTurns?: Turn[];
  projectId?: string | null;
  boundDocument?: string | null;
  /**
   * What this conversation already did in CATIA, from the server. Absent on the
   * chat home, where there is no history to have.
   */
  resume?: ConversationResume | null;
}

export function ChatView({
  fullName,
  email,
  conversationId = null,
  title = null,
  initialTurns,
  projectId = null,
  boundDocument = null,
  resume = null,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const [project, setProject] = useState<string | null>(projectId);

  const onConversationStarted = useCallback((id: string) => {
    // The id goes in the URL the moment the backend mints it, so a refresh — or
    // a click on anything in the sidebar and back — finds the conversation
    // again. `history.replaceState` is the supported way to do this without a
    // navigation: `router.replace` would re-render the route and cut the stream
    // that is still delivering this very turn.
    window.history.replaceState(null, "", `/dashboard/c/${id}`);
    notifyConversationsChanged();
  }, []);

  const {
    conversationId: liveConversationId,
    turns,
    busy,
    error,
    canRetry,
    allowMutations,
    setAllowMutations,
    liveSteps,
    thinking,
    narration,
    send,
    retry,
    stop,
  } = useAgentChat({
    conversationId,
    initialTurns,
    // Passed through so a project this hook creates for a brand-new
    // conversation (or one already known from the URL) is used on every turn,
    // not just the first -- see useAgentChat's own project-creation guard.
    projectId: project ?? undefined,
    defaultAllowMutations: true,
    onConversationStarted,
    onProjectCreated: setProject,
    onTurnFinished: notifyConversationsChanged,
  });

  const catia = useCatiaStatus(liveConversationId);
  const catiaDocument =
    catia.status?.document?.doc_name ?? (liveConversationId === conversationId ? boundDocument : null);

  // The open kernel's answer to "the user sees what the agent sees". On a seat
  // the picture arrives inside a tool result and is drawn in the step row; here
  // there is no capture, so it is asked for — and it is pinned to the live
  // state rather than to a turn, because the render endpoint draws the part as
  // it stands and has no history to place in a transcript. `kernelPartState`
  // returns `absent` on every CATIA deployment, so this renders nothing there.
  const partState = useMemo(
    () => kernelPartState(catia.status, liveConversationId),
    [catia.status, liveConversationId],
  );
  // Once per finished turn, not on a timer: the geometry moves when the agent
  // acts. A repeat over unchanged geometry costs a 304 — the render is
  // deterministic, so the ETag is a real content hash.
  const partRevision = busy ? turns.length : turns.length + 1;

  // The greeting depends on the reader's clock, and a server rendering in UTC
  // would wish a user in Abidjan good evening at noon. `useSyncExternalStore`
  // is the sanctioned way to say "the server cannot know this": it renders the
  // server snapshot (nothing), then the client one, with no hydration mismatch
  // and no state-setting effect.
  const greeting = useSyncExternalStore(subscribeNever, getGreeting, getServerGreeting);

  // "Picked up 3 days later" is measured against the reader's clock, so it is
  // client-only for the same reason the greeting is — a server rendering it
  // would be rendering someone else's idea of now, and the two would disagree
  // at every unit boundary. Recomputed only when the server's account changes,
  // which is once per page load.
  const mounted = useSyncExternalStore(subscribeNever, getMounted, getServerMounted);
  const notice = useMemo(() => (mounted ? resumeNotice(resume) : null), [mounted, resume]);

  const empty = turns.length === 0 && liveSteps.length === 0 && !busy;

  // Follows the newest content, but yields to a reader who has scrolled up —
  // during a long turn the old unconditional scroll fired on every tool event
  // and made reading back impossible. See `useStickToBottom`.
  const {
    ref: scrollRef,
    pinned,
    scrollToBottom,
  } = useStickToBottom([turns, liveSteps, narration, busy]);

  const submit = useCallback(() => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    void send(message);
  }, [busy, input, send]);

  const firstName = firstNameOf(fullName, email);

  /** The finished answer, announced once — nothing while it is still arriving. */
  const lastTurn = turns[turns.length - 1];
  const answer = !busy && lastTurn?.role === "assistant" ? lastTurn.content : "";

  /**
   * What a screen reader hears while the agent works.
   *
   * `activityLabel` is built from the same steps and loop state the panel
   * renders, so the announcement can never name a number the list contradicts
   * — it used to announce "step 3 of 20", a round budget, over a list that had
   * five rows in it. The model's own narration is announced only until there
   * is real progress to report: once steps exist, re-reading a sentence of
   * prose on every one of them buries the thing that changed.
   */
  const activity = busy
    ? liveSteps.length === 0 && narration
      ? narration
      : activityLabel(liveSteps, thinking)
    : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!empty && (
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <PartIcon className="size-4 shrink-0 text-primary" />
          <h1 className="truncate text-sm font-medium text-accent">
            {title ?? "New conversation"}
          </h1>
          {catiaDocument && (
            <span className="hidden shrink-0 rounded-sm bg-primary-soft px-2 py-0.5 font-mono text-[0.6875rem] text-blueprint sm:inline">
              {catiaDocument}
            </span>
          )}
          {project && (
            <Link
              href={`/dashboard/projects/${project}`}
              className="ml-auto shrink-0 text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              Open project
            </Link>
          )}
        </header>
      )}

      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className={`k-scroll h-full overflow-y-auto px-4 sm:px-6 ${
          empty ? "flex flex-col items-center justify-end pb-6" : "py-6"
        }`}
      >
        {empty ? (
          <div className="k-rise flex w-full max-w-2xl flex-col items-center text-center">
            <MeshOrb className="h-28 w-28 sm:h-32 sm:w-32" />
            <h1 className="mt-7 min-h-10 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              <span className="k-display-gradient">
                {greeting ? `${greeting}, ${firstName}` : ` `}
              </span>
            </h1>
            <p className="mt-1 font-display text-2xl text-muted sm:text-3xl">
              What are we building?
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            {/* At the head of the transcript, because that is where the story
                starts: this is what happened before anything below it. */}
            <ResumeNotice notice={notice} />

            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <MeshOrb className="h-5 w-5" working density="coarse" />
                <span>Working on it</span>
              </div>
            )}

            {turns.map((turn) =>
              turn.role === "user" ? (
                <p
                  key={turn.id}
                  className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary-soft px-3.5 py-2.5 text-[0.9375rem] text-blueprint"
                >
                  {turn.content}
                </p>
              ) : (
                <div key={turn.id} className="group max-w-[95%] space-y-3">
                  {turn.steps && turn.steps.length > 0 && <AgentStepList steps={turn.steps} />}
                  {turn.content && (
                    <>
                      <MarkdownMessage content={turn.content} />
                      {/* Revealed on hover or keyboard focus. Always in the DOM
                          so it is reachable by tab and by a screen reader —
                          `opacity` hides it from sight, not from the a11y tree. */}
                      <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <CopyButton content={turn.content} />
                      </div>
                    </>
                  )}
                  {turn.truncated && (
                    <p className="text-xs text-warning">
                      {/* Two different endings, two different remedies, and
                          saying the wrong one costs the user the next turn as
                          well. Measured on ladder prompt PRO1, 2026-09-08: the
                          agent was stopped at step 31 of 60 for re-issuing a
                          call the tool layer had already refused, and this line
                          told the user it had run out of rounds and to ask for
                          one thing at a time — half the budget was unspent, and
                          narrowing the request would not have stopped the
                          repeat.

                          "tool rounds" in the budget case matches the ceiling
                          the panel warns about on the way there — the same cap,
                          named the same way, rather than "steps", which the
                          panel uses for the rows in the list. */}
                      {turn.stopReason === "repeated_calls"
                        ? "The agent stopped because it kept repeating a call that had already been refused. Tell it what to do differently — it keeps everything it built."
                        : "The agent ran out of tool rounds for that turn. Ask for one thing at a time and it will get further."}
                    </p>
                  )}
                  {turn.error && (
                    <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
                      <p>{turn.error}</p>
                      {canRetry && turn.error === error && (
                        <button
                          type="button"
                          onClick={() => void retry()}
                          className="mt-1.5 rounded-sm font-medium underline underline-offset-2 hover:no-underline"
                        >
                          Try that message again
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}

            {(liveSteps.length > 0 || thinking) && (
              <AgentStepList steps={liveSteps} thinking={thinking} />
            )}
            {narration && <p className="text-sm italic text-muted">{narration}</p>}
          </div>
        )}
      </div>

        {/* Only while there is something below to go back to. On the empty
            state there is no transcript, and during a settled conversation a
            pinned view is already showing the newest turn. */}
        {!pinned && !empty && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted shadow-raised transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3v10M4 9.5 8 13.5l4-4" />
            </svg>
            {busy ? "Jump to what it's doing" : "Jump to latest"}
          </button>
        )}
      </div>

      {/* Announcements. The transcript itself is not a live region — re-reading
          a whole answer on every streamed chunk is unusable — so progress is
          summarised here and the finished answer is announced once. */}
      <p aria-live="polite" className="sr-only">
        {activity}
      </p>
      <p aria-live="polite" className="sr-only">
        {answer ? toPlainText(answer) : ""}
      </p>

      <div className={`px-4 pb-5 sm:px-6 ${empty ? "" : "pt-2"}`}>
        <div className="mx-auto w-full max-w-3xl">
          {/* Above the composer rather than in the transcript, and for the same
              reason the CATIA chip is here: this says what is true *now*. The
              render endpoint draws the document as it stands, so a copy of it
              sitting next to an old turn would quietly redraw itself into a
              later part. Renders nothing at all unless the open kernel is what
              builds here — see `lib/kernel-render.ts`. */}
          {liveConversationId !== null && (
            <div className="mb-2">
              <KernelPartView
                conversationId={liveConversationId}
                state={partState}
                revision={partRevision}
              />
            </div>
          )}
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            busy={busy}
            onStop={stop}
            deepAnalysis={allowMutations}
            onDeepAnalysisChange={setAllowMutations}
            autoFocus={empty}
            attachSlot={
              <AttachPill
                projectId={project}
                onAttached={(note) => setInput((previous) => note + previous)}
              />
            }
            statusSlot={
              <CatiaChip state={catia.state} detail={catia.detail} document={catiaDocument} />
            }
          />

          {empty && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {SUGGESTIONS.map((suggestion, index) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => setInput(suggestion.prompt)}
                  className="k-suggestion k-rise p-3.5"
                  style={{ animationDelay: `${120 + index * 70}ms` }}
                >
                  <span className="block text-xs font-medium uppercase tracking-wide text-primary">
                    {suggestion.label}
                  </span>
                  <span className="mt-1.5 block text-sm leading-snug text-muted">
                    {suggestion.prompt}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && !turns.some((turn) => turn.error === error) && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
            >
              <p>{error}</p>
              {canRetry && (
                <button
                  type="button"
                  onClick={() => void retry()}
                  className="mt-1.5 rounded-sm font-medium underline underline-offset-2 hover:no-underline"
                >
                  Try that message again
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
