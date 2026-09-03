/**
 * Conversation types, mirroring the `Conversation*` models in
 * `app/api/routes/ai.py`.
 *
 * A conversation is the product's primary object: it owns the transcript, the
 * project the agent created for it, and at most one CATIA document. Nothing
 * generates this file — diff it against the backend schemas when either side
 * changes.
 */

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
  messages: ConversationMessage[];
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
}

export interface ConversationPage {
  total: number;
  page: number;
  page_size: number;
  items: ConversationSummary[];
}
