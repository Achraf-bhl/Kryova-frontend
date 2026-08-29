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

/** `GET /catia/status` when no workstation is currently connected. */
export interface CatiaStatusOffline {
  connected: false;
  enabled: boolean;
  paired_devices: number;
  document: CatiaDocumentBinding | null;
  /** Why, in words a user can act on: nothing paired vs paired but offline. */
  detail: string;
}

/** `GET /catia/status` when a workstation is holding the socket open. */
export interface CatiaStatusOnline {
  connected: true;
  enabled: boolean;
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
  queue_depth: number;
  connected_since: string;
}

export type CatiaStatus = CatiaStatusOffline | CatiaStatusOnline;

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
