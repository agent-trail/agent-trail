export type RowKind = "session" | "trail";

export type RowState = "source" | "registered" | "source+registered";

export type Row = {
  state: RowState;
  source_id: string | null;
  source_agent: string | null;
  source_cwd: string | null;
  source_modified_at: string | null;
  source_path: string | null;
  content_hash: string | null;
  registered_agent: string | null;
  registered_cwd: string | null;
  registered_at: string | null;
  registered_source_path: string | null;
  registered_kind: RowKind | null;
  agent: string | null;
  cwd: string | null;
  latest_at: string | null;
  display_name?: string | null;
};
