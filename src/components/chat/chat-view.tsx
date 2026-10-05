"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { activityLabel, AgentStepList } from "@/components/agent-step-list";
import { AttachPill } from "@/components/chat/attach-pill";
import { CatiaChip } from "@/components/chat/catia-chip";
import { CheckpointsMenu } from "@/components/chat/checkpoints-menu";
import { Composer } from "@/components/chat/composer";
import { matchShortcut } from "@/lib/shortcuts";
import { explainStop } from "@/lib/stop-reason";
import { UsageMeter } from "@/components/chat/usage-meter";
import { CopyButton } from "@/components/chat/copy-button";
import { ContinuePrompt } from "@/components/chat/continue-prompt";
import { InterventionPrompt } from "@/components/chat/intervention-prompt";
import {
  BranchButton,
  BranchNotice,
  RewindActions,
  RewindRefusal,
} from "@/components/chat/message-actions";
import { RateLimitNotice } from "@/components/chat/rate-limit-notice";
import { ResumeNotice } from "@/components/chat/resume-notice";
import { MarkdownMessage } from "@/components/markdown-message";
import { AttachmentPanel } from "@/components/attachments/attachment-panel";
import { SpecPanel } from "@/components/design/spec-panel";
import { MemoryProposals } from "@/components/project-memory/memory-proposals";
import { KernelPartView } from "@/components/kernel-part-view";
import { MeshOrb } from "@/components/mesh-orb";
import { PartIcon } from "@/components/ui/icons";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { useAttachUpload } from "@/hooks/use-attach-upload";
import { useCatiaStatus } from "@/hooks/use-catia-status";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { api } from "@/lib/api-client";
import { notifyConversationsChanged } from "@/lib/conversation-events";
import { resumeNotice } from "@/lib/conversation-resume";
import { kernelPartState } from "@/lib/kernel-render";
import { isLocalKernel } from "@/types/catia";
import { branchPointAt, branchPointBefore, lastTypedIndex } from "@/lib/conversation-transcript";
import type { Turn } from "@/lib/conversation-transcript";
import { toPlainText } from "@/lib/markdown";
import type { BranchedFrom, ConversationResume } from "@/types/conversation";

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
  /** Where this conversation was branched from, when it was (2.5). */
  branchedFrom?: BranchedFrom | null;
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
  branchedFrom = null,
}: ChatViewProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  // Why Retry, Edit or Branch did not happen, shown under the message it was for.
  const [issue, setIssue] = useState<{ reason: string; refused: boolean } | null>(null);
  const [branching, setBranching] = useState(false);
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
    retryAt,
    canRetry,
    allowMutations,
    setAllowMutations,
    liveSteps,
    thinking,
    narration,
    streamingText,
    send,
    continueTurn,
    rewindLast,
    retry,
    stop,
    stopping,
    usage,
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

  // Esc stops a running turn (8.7) — the same polite stop as the button, so the first
  // press ends it at the next step and a second cuts the stream. An open dialog marks its
  // own Esc handled (`defaultPrevented`), and a field with an open picker keeps its Esc.
  useEffect(() => {
    if (!busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || matchShortcut(event) !== "stop") return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      stop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, stop]);

  const catia = useCatiaStatus(liveConversationId);
  // One upload controller for both ways in — the pill and the composer's drop
  // zone. The LIVE conversation id, not the prop: a new chat has no conversation
  // until its first turn, and an attachment posted against null would reach no
  // conversation and never enter the agent's turn.
  const attach = useAttachUpload({
    projectId: project,
    conversationId: liveConversationId ?? conversationId,
    onAttached: useCallback((note: string) => setInput((previous) => note + previous), []),
  });

  const catiaDocument =
    catia.status?.document?.doc_name ?? (liveConversationId === conversationId ? boundDocument : null);
  // A rollback means something only where `catia_restore` exists: a seat holding a bound
  // document. The open kernel has no restore, so it is not offered a button that cannot work.
  const canRollBack =
    Boolean(catiaDocument) && catia.status?.connected === true && !isLocalKernel(catia.status);

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
  } = useStickToBottom([turns, liveSteps, narration, streamingText, busy]);

  const submit = useCallback(() => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setIssue(null);
    void send(message);
  }, [busy, input, send]);

  /**
   * Retry and Edit both take the newest message back first (2.5). The server
   * refuses when that turn changed the part, and says so; nothing is trimmed on
   * screen unless it deleted the same span.
   */
  const retryLast = useCallback(async () => {
    setIssue(null);
    const outcome = await rewindLast();
    if (!outcome.ok) {
      setIssue(outcome);
      return;
    }
    void send(outcome.message);
  }, [rewindLast, send]);

  const editLast = useCallback(async () => {
    setIssue(null);
    const outcome = await rewindLast();
    if (!outcome.ok) {
      setIssue(outcome);
      return;
    }
    setInput(outcome.message);
  }, [rewindLast]);

  /** `fromSequence` undefined is the newest answer, which is the server's default. */
  const branchFrom = useCallback(
    async (fromSequence: number | undefined) => {
      if (!liveConversationId || branching) return;
      setBranching(true);
      setIssue(null);
      try {
        const result = await api.branchConversation(liveConversationId, fromSequence);
        notifyConversationsChanged();
        router.push(`/dashboard/c/${result.conversation_id}`);
      } catch (err) {
        setIssue({
          reason: err instanceof Error ? err.message : "That conversation could not be branched.",
          refused: false,
        });
      } finally {
        setBranching(false);
      }
    },
    [branching, liveConversationId, router],
  );

  // The one message Retry and Edit act on — the newest the person typed — and only
  // once a conversation exists for the server to rewind.
  const rewindable = busy || !liveConversationId ? -1 : lastTypedIndex(turns);

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
          {canRollBack && liveConversationId && (
            <div className="ml-auto">
              <CheckpointsMenu conversationId={liveConversationId} />
            </div>
          )}
          {project && (
            <Link
              href={`/dashboard/projects/${project}`}
              className={`${canRollBack && liveConversationId ? "" : "ml-auto "}shrink-0 text-xs text-muted underline-offset-2 hover:text-accent hover:underline`}
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
            <BranchNotice from={branchedFrom} hasDocument={Boolean(catiaDocument)} />
            <ResumeNotice notice={notice} />

            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <MeshOrb className="h-5 w-5" working density="coarse" />
                <span>Working on it</span>
              </div>
            )}

            {turns.map((turn, index) =>
              turn.role === "user" && turn.continuation ? (
                // The person pressed Continue. A divider, not a bubble: the
                // text the model was sent is the server's, and drawing it in
                // the user's voice would put words in their mouth.
                <p
                  key={turn.id}
                  className="flex items-center gap-3 text-xs text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
                >
                  {turn.content}
                </p>
              ) : turn.role === "user" ? (
                <div
                  key={turn.id}
                  className="group ml-auto flex max-w-[85%] flex-col items-end gap-1"
                >
                  <p className="whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary-soft px-3.5 py-2.5 text-[0.9375rem] text-blueprint">
                    {turn.content}
                  </p>
                  {index === rewindable && (
                    <RewindActions
                      disabled={branching}
                      onRetry={() => void retryLast()}
                      onEdit={() => void editLast()}
                    />
                  )}
                  {index === lastTypedIndex(turns) && issue && (
                    <RewindRefusal
                      reason={issue.reason}
                      canBranch={issue.refused && branchPointBefore(turns, index) !== null}
                      onBranch={() => {
                        const point = branchPointBefore(turns, index);
                        if (point) void branchFrom(point.fromSequence);
                      }}
                      onDismiss={() => setIssue(null)}
                    />
                  )}
                </div>
              ) : (
                <div key={turn.id} className="group max-w-[95%] space-y-3">
                  {turn.steps && turn.steps.length > 0 && <AgentStepList steps={turn.steps} />}
                  {turn.content && (
                    <>
                      <MarkdownMessage content={turn.content} />
                      {/* Revealed on hover or keyboard focus. Always in the DOM
                          so it is reachable by tab and by a screen reader —
                          `opacity` hides it from sight, not from the a11y tree. */}
                      <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <CopyButton content={turn.content} />
                        {/* Only where the server would start a branch, and only
                            while nothing is running: a branch copies a
                            transcript, and one cut mid-turn would copy half. */}
                        {!busy && branchPointAt(turns, index, busy) && (
                          <BranchButton
                            disabled={branching}
                            onBranch={() => {
                              const point = branchPointAt(turns, index, busy);
                              if (point) void branchFrom(point.fromSequence);
                            }}
                          />
                        )}
                      </div>
                    </>
                  )}
                  {turn.truncated &&
                    (() => {
                      // Wording, tone and the one page-shaped remedy live in
                      // `lib/stop-reason.ts`, one test per ending. The buttons
                      // below (decision, Continue) come from the server.
                      const stop = explainStop(turn.stopReason, {
                        hasIntervention: Boolean(turn.intervention),
                        hasNextAction: Boolean(turn.nextAction),
                      });
                      return (
                        <p className={stop.tone === "warning" ? "text-xs text-warning" : "text-xs text-muted"}>
                          {stop.text}
                          {stop.link && (
                            <>
                              {" "}
                              <Link href={stop.link.href} className="font-medium underline underline-offset-2">
                                {stop.link.label}
                              </Link>
                            </>
                          )}
                        </p>
                      );
                    })()}
                  {/* The decision itself, under the answer it interrupted.
                      Below the banner on purpose: the banner says the turn
                      stopped, and this says what to do about it — a prompt
                      above the explanation is a question with its context
                      hidden behind it. */}
                  {turn.intervention && (
                    <InterventionPrompt
                      intervention={turn.intervention}
                      disabled={busy}
                      onAnswer={(text) => void send(text)}
                    />
                  )}
                  {/* Only the newest turn can be continued. Anything later in
                      the thread means the work already moved on, and a button
                      under an older answer would resume it a second time. */}
                  {turn.nextAction && index === turns.length - 1 && (
                    <ContinuePrompt
                      action={turn.nextAction}
                      disabled={busy}
                      onContinue={() => void continueTurn()}
                    />
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
            {/* The answer arriving token by token (P5.1). Plain text, not
                markdown: half a fenced block is not a fenced block, and a
                renderer asked to parse one mid-word produces a paragraph that
                reshapes itself on every chunk. The `message` event replaces
                this with the parsed, finished answer. */}
            {streamingText && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{streamingText}</p>
            )}
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
            <div className="mb-2 space-y-2">
              {/* The spec above the picture, deliberately. The conversation is
                  the log and the spec is the truth, and a panel that put the
                  render first would put the *consequence* above the thing that
                  decides it. Renders nothing until a design has been recorded —
                  most conversations never record one, and a permanent "no
                  design" box above every composer is furniture. */}
              <SpecPanel conversationId={liveConversationId} revision={partRevision} />
              {/* What the user handed over, beneath the design and above the
                  picture: the spec is the truth, the attachments are the
                  evidence behind it, and the render is the consequence.
                  Renders nothing until something is attached. */}
              <AttachmentPanel conversationId={liveConversationId} revision={partRevision} />
              {/* What the assistant suggested remembering about the project and has
                  not been told yet. Renders nothing unless there is one waiting. */}
              {project && <MemoryProposals projectId={project} revision={partRevision} />}
              <KernelPartView
                conversationId={liveConversationId}
                state={partState}
                revision={partRevision}
              />
            </div>
          )}
          {/* Counts down to the moment the server said sending is allowed again. */}
          {retryAt !== null && <RateLimitNotice key={retryAt} retryAt={retryAt} />}
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            busy={busy}
            onStop={stop}
            stopping={stopping}
            deepAnalysis={allowMutations}
            onDeepAnalysisChange={setAllowMutations}
            autoFocus={empty}
            onFilesDropped={project ? (files) => void attach.uploadAll(files) : undefined}
            attachSlot={
              <AttachPill projectId={project} controller={attach} />
            }
            statusSlot={
              <CatiaChip state={catia.state} detail={catia.detail} document={catiaDocument} />
            }
          />
          <UsageMeter conversationId={liveConversationId ?? conversationId ?? null} live={usage} />

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
