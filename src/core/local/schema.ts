/** Added only when creating format 2. This module does not mutate existing spaces. */
export const IMPORT_SCHEMA_SQL = `
CREATE TABLE import_runs(id TEXT PRIMARY KEY,manifest_digest TEXT NOT NULL,manifest_json TEXT NOT NULL,namespace TEXT NOT NULL,instance_id TEXT NOT NULL,profile_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('ready','running','paused','needs-repreview','finished','finished-with-errors')),progress_revision INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT;
CREATE TABLE import_items(run_id TEXT NOT NULL REFERENCES import_runs(id),id TEXT NOT NULL,position INTEGER NOT NULL,target_id TEXT NOT NULL,source_key TEXT NOT NULL,source_version TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL CHECK(state IN ('pending','committed','reused','skipped','failed','blocked')),attempt INTEGER NOT NULL,op_key TEXT NOT NULL,result_json TEXT,error_json TEXT,original_revision INTEGER,PRIMARY KEY(run_id,id)) STRICT;
CREATE UNIQUE INDEX import_origin_claim ON import_items(source_key,source_version) WHERE claimed=1;
CREATE INDEX import_item_order ON import_items(run_id,position);
CREATE TRIGGER immutable_import_manifest BEFORE UPDATE OF id,manifest_digest,manifest_json,namespace,instance_id,profile_id,created_at ON import_runs BEGIN SELECT RAISE(ABORT,'immutable import manifest'); END;
CREATE TRIGGER immutable_import_item_identity BEFORE UPDATE OF run_id,id,position,target_id,source_key,source_version ON import_items BEGIN SELECT RAISE(ABORT,'immutable import item'); END;
`;
