export type CatiaConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type CatiaEventType =
  | "geometry_exported"
  | "parameters_changed"
  | "design_table_updated"
  | "simulation_requested";

export interface CatiaEvent {
  type: CatiaEventType;
  timestamp: string;
  document_name: string;
  file_path?: string;
  file_format: "step" | "iges" | "stl";
  size_bytes?: number;
}

export interface CatiaStatus {
  state: CatiaConnectionState;
  version?: string;
  document?: string;
  last_event_at?: string;
  error_message?: string;
}
