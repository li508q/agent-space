import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  constants,
  closeSync,
  openSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  chmodSync,
  rmSync,
  rmdirSync,
  readSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SpaceStatus } from '../contracts/core.js';
import { CORE_VERSION, FORMAT_VERSION, fail, checkedJson } from './support.js';

export type Row = Record<string, string | number | null | Uint8Array>;
const APP_ID = 0x41535043;
export class Store {
  readonly db: DatabaseSync;
  readonly secret: string;
  readonly spaceId: string;
  readonly instanceId: string;
  private constructor(
    readonly directory: string,
    creating: boolean,
    options?: { title: string; example: boolean },
  ) {
    const filename = join(directory, 'space.sqlite');
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('INVALID_INPUT');
    if (info.size > 536_870_912) fail('LIMIT_EXCEEDED');
    if (!creating) {
      const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const header = Buffer.alloc(16);
        readSync(fd, header, 0, 16, 0);
        if (header.toString() !== 'SQLite format 3\0') fail('INTEGRITY_FAILURE');
      } finally {
        closeSync(fd);
      }
    }
    this.db = new DatabaseSync(filename, { timeout: 5000, allowExtension: false });
    try {
      const version = String(this.one('SELECT sqlite_version() AS version').version)
        .split('.')
        .map(Number);
      if (
        Number(version[0]) < 3 ||
        (version[0] === 3 &&
          (Number(version[1]) < 51 || (version[1] === 51 && Number(version[2]) < 3)))
      )
        fail('SCHEMA_UNSUPPORTED');
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;');
      if (creating) this.initialize(options!);
      else this.checkVersion();
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.db.exec(
        `PRAGMA max_page_count=${Math.floor(536_870_912 / Number(this.one('PRAGMA page_size').page_size))}`,
      );
      const meta = this.one('SELECT * FROM space_meta WHERE id=1');
      this.secret = String(meta.cursor_secret);
      this.spaceId = String(meta.space_id);
      this.instanceId = String(meta.instance_id);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  static create(directory: string, options: { title: string; example: boolean }): Store {
    let createdDirectory = false;
    try {
      mkdirSync(directory, { mode: 0o700 });
      createdDirectory = true;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
        throw error;
    }
    const actual = realpathSync(directory);
    if (
      !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink() ||
      readdirSync(actual).length
    )
      fail('INVALID_INPUT');
    chmodSync(actual, 0o700);
    const filename = join(actual, 'space.sqlite');
    const fd = openSync(
      filename,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    closeSync(fd);
    try {
      return new Store(actual, true, options);
    } catch (error) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
      if (createdDirectory) {
        try {
          rmdirSync(actual);
        } catch {
          /* Preserve anything not owned by creation. */
        }
      }
      throw error;
    }
  }
  static open(directory: string): Store {
    return new Store(realpathSync(directory), false);
  }
  one(sql: string, ...params: SQLInputValue[]): Row {
    const row = this.db.prepare(sql).get(...params);
    if (!row) fail('NOT_FOUND');
    return row as Row;
  }
  maybe(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  checkVersion(): void {
    if (
      this.one('PRAGMA application_id').application_id !== APP_ID ||
      this.one('PRAGMA user_version').user_version !== FORMAT_VERSION
    )
      fail('SCHEMA_UNSUPPORTED');
    const meta = this.one('SELECT space_id,instance_id,core_version FROM space_meta WHERE id=1');
    if (meta.core_version !== CORE_VERSION) fail('SCHEMA_UNSUPPORTED');
    if (this.spaceId && (this.spaceId !== meta.space_id || this.instanceId !== meta.instance_id))
      fail('SPACE_MISMATCH');
  }
  status(): SpaceStatus {
    const m = this.one('SELECT * FROM space_meta WHERE id=1');
    return {
      spaceId: String(m.space_id),
      instanceId: String(m.instance_id),
      title: String(m.title),
      example: Boolean(m.example),
      formatVersion: 1,
      coreContractVersion: 1,
      authoritySequence: Number(m.authority_seq),
      activitySequence: Number(this.one('SELECT COALESCE(MAX(id),0) AS seq FROM activity').seq),
    };
  }
  close(): void {
    if (this.db.isOpen) this.db.close();
  }
  private initialize(options: { title: string; example: boolean }): void {
    this.db.exec(`BEGIN IMMEDIATE;
      PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
      CREATE TABLE space_meta(id INTEGER PRIMARY KEY CHECK(id=1),space_id TEXT NOT NULL,instance_id TEXT NOT NULL,title TEXT NOT NULL,example INTEGER NOT NULL,cursor_secret TEXT NOT NULL,core_version INTEGER NOT NULL,authority_seq INTEGER NOT NULL) STRICT;
      CREATE TABLE objects(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('document','project','record','asset')),head INTEGER NOT NULL,FOREIGN KEY(id,head) REFERENCES revisions(object_id,revision) DEFERRABLE INITIALLY DEFERRED) STRICT;
      CREATE TABLE revisions(object_id TEXT NOT NULL REFERENCES objects(id),revision INTEGER NOT NULL,parent INTEGER,content_json TEXT NOT NULL,policy_json TEXT NOT NULL,origin_json TEXT NOT NULL,lifecycle TEXT NOT NULL CHECK(lifecycle IN ('active','archived')),digest TEXT NOT NULL,actor_json TEXT NOT NULL,created_at TEXT NOT NULL,change_id TEXT NOT NULL UNIQUE,authority_seq INTEGER NOT NULL,PRIMARY KEY(object_id,revision),FOREIGN KEY(object_id,parent) REFERENCES revisions(object_id,revision)) STRICT;
      CREATE TABLE search_projection(object_id TEXT PRIMARY KEY REFERENCES objects(id),normalized TEXT NOT NULL) STRICT;
      CREATE VIRTUAL TABLE search_fts USING fts5(object_id UNINDEXED,normalized,tokenize='trigram');
      CREATE TABLE changes(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,action TEXT NOT NULL,object_id TEXT,before_revision INTEGER,after_revision INTEGER,proposal_id TEXT,actor_json TEXT NOT NULL,recorded_at TEXT NOT NULL) STRICT;
      CREATE TABLE receipts(namespace TEXT NOT NULL,op_key TEXT NOT NULL,command TEXT NOT NULL,request_digest TEXT NOT NULL,result_json TEXT NOT NULL,summary_json TEXT NOT NULL,access_json TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(namespace,op_key)) STRICT;
      CREATE TABLE grants(id TEXT PRIMARY KEY,generation INTEGER NOT NULL,spec_json TEXT NOT NULL,token_hash TEXT NOT NULL,revoked INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT;
      CREATE TABLE proposals(id TEXT PRIMARY KEY,action TEXT NOT NULL,target_id TEXT NOT NULL,kind TEXT NOT NULL,base_revision INTEGER,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,grant_id TEXT NOT NULL REFERENCES grants(id),status TEXT NOT NULL CHECK(status IN ('pending','conflicted','applied','rejected')),status_version INTEGER NOT NULL,result_revision INTEGER,created_at TEXT NOT NULL,resolved_at TEXT,conflict_code TEXT) STRICT;
      CREATE TABLE reservations(object_id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id)) STRICT;
      CREATE TABLE proposal_seen(proposal_id TEXT NOT NULL REFERENCES proposals(id),namespace TEXT NOT NULL,seen INTEGER NOT NULL,PRIMARY KEY(proposal_id,namespace)) STRICT;
      CREATE TABLE knowledge_reviews(object_id TEXT NOT NULL,revision INTEGER NOT NULL,actor_json TEXT NOT NULL,reviewed_at TEXT NOT NULL,PRIMARY KEY(object_id,revision),FOREIGN KEY(object_id,revision) REFERENCES revisions(object_id,revision)) STRICT;
      CREATE TABLE drafts(namespace TEXT NOT NULL,id TEXT NOT NULL,generation INTEGER NOT NULL,target_json TEXT NOT NULL,source_json TEXT NOT NULL,content_json TEXT,digest TEXT NOT NULL,retained INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(namespace,id)) STRICT;
      CREATE TABLE activity(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,actor_json TEXT NOT NULL,recorded_at TEXT NOT NULL,object_id TEXT,proposal_id TEXT,authority_seq INTEGER,tool TEXT,delivered_json TEXT NOT NULL,details_json TEXT NOT NULL) STRICT;
      CREATE INDEX changes_object ON changes(object_id,seq);
      CREATE INDEX proposals_status ON proposals(status,id);
      CREATE TRIGGER immutable_object_identity BEFORE UPDATE OF id,kind ON objects BEGIN SELECT RAISE(ABORT,'immutable object identity'); END;
      CREATE TRIGGER immutable_revision_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
      CREATE TRIGGER immutable_revision_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
      CREATE TRIGGER immutable_receipt_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
      CREATE TRIGGER immutable_receipt_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
      CREATE TRIGGER immutable_proposal BEFORE UPDATE OF id,action,target_id,kind,base_revision,payload_json,payload_hash,grant_id,created_at ON proposals BEGIN SELECT RAISE(ABORT,'immutable proposal'); END;
    `);
    this.db
      .prepare('INSERT INTO space_meta VALUES (1,?,?,?,?,?,1,0)')
      .run(
        randomUUID(),
        randomUUID(),
        options.title,
        Number(options.example),
        randomBytes(32).toString('hex'),
      );
    this.db.exec('COMMIT');
  }
}
export function rowJson<T>(row: Row, key: string): T {
  return checkedJson<T>(row[key]);
}
