/**
 * Conversation types, mirroring the `Conversation*` models in
 * `app/api/routes/ai.py`.
 *
 * A conversation is the product's primary object: it owns the transcript, the
 * project the agent created for it, and at most one CATIA document. Nothing
 * generates this file — diff it against the backend schemas when either side
 * changes.
 */

import type { NextAction } from "@/lib/agent-stream";

export type ConversationRole = "user" | "assistant" | "tool";

/** One stored message. Tool rows carry the step detail the live stream emits. */
export interface ConversationMessage {
  sequence: number;
  role: ConversationRole;
  content: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  /** Human label for a tool step, matching the live stream. */
  label: string | null;
  arguments: Record<string, unknown> | null;
  result: unknown;
  summary: string | null;
  is_error: boolean;
  duration_ms: number | null;
  /**
   * True when the user pressed Continue rather than typing (ROAD_TO_10 2.2).
   * The row's `content` is the server's own continuation text, which is not the
   * user's prose and must not be drawn as a chat bubble. Optional so a backend
   * that predates the field reads as "typed".
   */
  continuation?: boolean;
  /**
   * An assistant answer a branch may start at (ROAD_TO_10 2.5): text with no tool
   * calls waiting on results. The server decides, so the UI never offers Branch
   * where the server would refuse it. Optional so an older backend reads as "no".
   */
  branchable?: boolean;
  created_at: string;
}

/** A CATIA call whose most recent attempt in this conversation failed. */
export interface UnfinishedOperation {
  tool: string;
  /** The same human label the step list uses. */
  label: string;
  error: string;
  attempts: number;
}

/**
 * What this conversation already did in CATIA.
 *
 * Read from the backend's own log of the calls, which is the same source the
 * agent's state block reads. That is the point: the human returning to a
 * conversation and the model resuming it see the identical account of where the
 * work got to. Two different answers to "what did we do" on one screen is worse
 * than one of them being absent.
 */
export interface ConversationResume {
  operations: number;
  last_activity_at: string | null;
  unfinished: UnfinishedOperation[];
  /**
   * The plan the agent declared, as the server holds it (ROAD_TO_10 2.3). Null
   * when no plan was ever declared. Optional so a backend that predates the
   * field reads as "no plan" rather than as an error.
   */
  plan?: ResumePlan | null;
  /** The recorded design, when the agent described the part as a specification. */
  design?: ResumeDesign | null;
}

export interface ResumePlan {
  total: number;
  settled: number;
  /** Tasks not yet done or skipped, in plan order. */
  open: { id: string; title: string; state: string }[];
  /** What is ready to start now, or null when everything left is blocked. */
  next: { id: string; title: string } | null;
}

export interface ResumeDesign {
  name: string;
  revision: number;
  parameters: number;
}

/** `GET /ai/conversations/{id}` — everything needed to rehydrate a chat. */
export interface ConversationDetail {
  conversation_id: string;
  title: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  has_catia_document: boolean;
  catia_document: string | null;
  resume: ConversationResume;
  prompt_tokens: number;
  completion_tokens: number;
  /**
   * What Continue would do, when the newest turn stopped in a way that can be
   * continued and nothing has been said since (2.2). Computed server-side from
   * the stored turn record, so it survives a reload and a resume gap — a button
   * that existed only as a live event would vanish the moment somebody
   * refreshed the page, which is when they are most likely to want it.
   */
  next_action?: NextAction | null;
  /** Pinned conversations sort first in the sidebar (2.6). */
  pinned?: boolean;
  /**
   * Where this conversation was branched from (2.5), or null — also null once the
   * source has been deleted, because a branch outlives it.
   */
  branched_from?: BranchedFrom | null;
  messages: ConversationMessage[];
}

export interface BranchedFrom {
  conversation_id: string;
  title: string;
  /** The message of the source the copy ends at. */
  at_sequence: number;
}

/** One row of the sidebar. */
export interface ConversationSummary {
  conversation_id: string;
  title: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  /** Filled dot in the sidebar: reopening this chat reopens a CATIA part. */
  has_catia_document: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  pinned?: boolean;
  branched_from_id?: string | null;
  /** With a search: whether the title or one of the user's own messages matched. */
  match?: "title" | "message" | null;
}

export interface ConversationPage {
  total: number;
  page: number;
  page_size: number;
  items: ConversationSummary[];
}

/** `POST /ai/conversations/{id}/branch` (2.5). */
export interface BranchResult {
  conversation_id: string;
  title: string;
  from_sequence: number;
  copied_messages: number;
  design_revision: number | null;
  plan_copied: boolean;
  summary_kept: boolean;
  /** What was and was not carried over, in words — always says the CATIA document was not. */
  notes: string[];
}

/** `POST /ai/conversations/{id}/rewind` (2.5): the message to send again or edit first. */
export interface RewindResult {
  message: string;
  removed_messages: number;
}
