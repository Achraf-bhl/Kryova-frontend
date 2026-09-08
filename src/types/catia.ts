/**
 * CATIA bridge types, mirroring `app/api/routes/catia.py` and
 * `docs/CATIA_BRIDGE_PROTOCOL.md`.
 *
 * The topology matters for reading these: the bridge daemon dials **out** to
 * the Kryova backend over a WebSocket. There is no localhost HTTP server on the
 * engineer's machine, no `:9100`, and the browser never talks to the daemon.
 * The backend is the only source of truth for "is CATIA connected", so every
 * type here describes a backend response — not a device response.
 */

/** The document a conversation owns, if the agent has opened one. */
export interface CatiaDocumentBinding {
  doc_name: string;
  latest_checkpoint_id: string | null;
  bound_at: string;
}

/**
 * What the open kernel is holding for one conversation.
 *
 * A different shape from {@link CatiaDocumentBinding} and deliberately so: on
 * this backend nothing is saved to disk and there is no checkpoint to name.
 * `evicted` is the case that matters — the part was dropped to bound memory,
 * nothing was saved, and it is not coming back. A `null` document means nothing
 * has been built yet, which is not the same thing and must not read like it.
 */
export interface KernelDocument {
  doc_name: string | null;
  evicted: boolean;
}

/** `GET /catia/status` when no workstation is currently connected. */
export interface CatiaStatusOffline {
  connected: false;
  enabled: boolean;
  backend: "catia";
  paired_devices: number;
  document: CatiaDocumentBinding | null;
  /** Why, in words a user can act on: nothing paired vs paired but offline. */
  detail: string;
}

/** `GET /catia/status` when a workstation is holding the socket open. */
export interface CatiaStatusOnline {
  connected: true;
  enabled: boolean;
  backend: "catia";
  paired_devices: number;
  document: CatiaDocumentBinding | null;
  device_id: string;
  device_name: string;
  hostname: string;
  catia_version: string;
  bridge_version: string;
  /** True when the daemon is running its no-CATIA simulator. */
  mock: boolean;
  capabilities: string[];
  /**
   * Which language CATIA's own interface is running in on that workstation, as
   * a two-letter code, or `""` when the daemon could not tell.
   *
   * Not the user's language and not a Kryova setting: it is chosen when CATIA
   * is installed, and the bridge is the only thing that can see it. Empty is
   * normal, not an error — the assistant then names commands in English and
   * reads the seat's real labels off its live menus.
   */
  ui_language: string;
  queue_depth: number;
  connected_since: string;
}

/**
 * `GET /catia/status` when geometry is built by the open kernel in the API
 * process, with no seat involved at all (`GEOMETRY_BACKEND=occt`).
 *
 * `connected: true` because a tool call will succeed, which is what that field
 * means to every reader of it — but **none of the device fields exist here**:
 * there is no `device_name`, no `catia_version`, no `hostname`, no
 * `connected_since`. Treating this as a {@link CatiaStatusOnline} is not a
 * theoretical mistake; it is the one that shipped. `describe()` read
 * `status.device_name` off it and put the literal string "undefined is
 * connected, running CATIA" into the chip's tooltip and its screen-reader text
 * on every open-kernel deployment.
 */
export interface CatiaStatusLocalKernel {
  connected: true;
  enabled: boolean;
  backend: "occt";
  /** The OCCT build actually loaded — the provenance a result is bound to. */
  backend_version: string;
  paired_devices: 0;
  operations_implemented: number | null;
  operations_declared: number | null;
  open_documents: number;
  document: KernelDocument | null;
  detail: string;
}

export type CatiaStatus = CatiaStatusOffline | CatiaStatusOnline | CatiaStatusLocalKernel;

/**
 * Whether the open kernel is what builds here.
 *
 * A type predicate rather than a boolean expression at each call site, because
 * narrowing is the entire point: `connected: true` on its own leaves
 * `CatiaStatusOnline | CatiaStatusLocalKernel`, and every device field a caller
 * reaches for after that is `undefined` at runtime on half of it. With this in
 * front, `tsc` refuses the code that shipped the literal word "undefined" into
 * the status chip — and it did refuse it, in `use-catia-status.ts` and in
 * `catia-bridge-panel.tsx`, the moment the union learnt about this third shape.
 *
 * Discriminating on `backend` rather than on the absence of `device_name`,
 * because "a field I did not find" is how that bug happened in the first place.
 * The backend has sent `backend` on all three shapes since the open kernel
 * existed.
 */
export function isLocalKernel(status: CatiaStatus | null): status is CatiaStatusLocalKernel {
  return status !== null && status.backend === "occt";
}

/** The status narrowed to the open kernel, or null when a seat is what builds. */
export function localKernelOf(status: CatiaStatus | null): CatiaStatusLocalKernel | null {
  return isLocalKernel(status) ? status : null;
}

export type CatiaDeviceStatus = "pending" | "active" | "revoked";

/** One row of `GET /catia/devices`. */
export interface CatiaDevice {
  id: string;
  name: string;
  hostname: string | null;
  status: CatiaDeviceStatus | string;
  online: boolean;
  catia_version: string | null;
  bridge_version: string | null;
  is_mock: boolean;
  last_seen_at: string | null;
  created_at: string;
}

/** `POST /catia/devices`. The pairing code is shown exactly once. */
export interface CatiaDeviceCreated {
  device: CatiaDevice;
  pairing_code: string;
  pairing_expires_at: string;
  /** The exact command to run on the Windows workstation. */
  command: string;
}

/**
 * Event names the browser can receive on `GET /catia/events`.
 *
 * The backend drops anything outside its own vocabulary before publishing, so
 * this union is closed — but `CatiaEvent.event` stays widened with `string` so
 * a backend that learns a new name cannot crash a client that has not shipped
 * yet.
 */
export type CatiaEventName =
  | "stream_open"
  | "bridge_connected"
  | "document_opened"
  | "document_saved"
  | "geometry_changed"
  | "parameters_changed"
  | "checkpoint_created"
  | "export_completed"
  | "catia_lost";

/** One SSE frame: `{"event": …, "at": …, "data": {…}}`. */
export interface CatiaEvent {
  event: CatiaEventName | string;
  at: string;
  data: Record<string, unknown>;
}

/** How the UI describes the bridge right now. */
export type CatiaConnectionState = "connecting" | "connected" | "offline" | "unavailable";
