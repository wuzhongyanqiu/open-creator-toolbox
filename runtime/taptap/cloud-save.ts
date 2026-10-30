/** TapTap H5 immutable backups. No SDK package, credentials or cross-repository imports. */
export type RawSnapshot = Record<string, string | null>;
export interface SaveKey { key: string; required?: boolean }
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; readonly length?: number; key?(index: number): string | null }
export type NativeOptions = Record<string, unknown> & { success: (value?: any) => void; fail: (error?: any) => void };
export interface CloudRuntime {
  env: { USER_DATA_PATH: string };
  getFileSystemManager(): { writeFile(o: NativeOptions): void; readFile(o: NativeOptions): void };
  getCloudSaveManager(): { getArchiveList(o: NativeOptions): void; getArchiveData(o: NativeOptions): void; createArchive(o: NativeOptions): void; deleteArchive?(o: NativeOptions): void };
}
export interface CloudConfig {
  appId: string;
  schema: string | number;
  keys: readonly SaveKey[];
  storage: StoragePort;
  /** Validate original strings, including active-run/legacy schema. Never normalize them here. */
  validate: (raw: RawSnapshot) => boolean;
  describe: (raw: RawSnapshot) => string;
  readBlocked?: () => boolean;
  /** Increment for accepted in-memory changes too, including a failed disk write. */
  localRevision?: () => unknown;
  /** Cancel pending game writes; every game persistence path must honour this barrier. */
  lockWrites: () => () => void;
  /** Opaque login-session epoch, null before login; never include login codes in a payload. */
  accountToken: () => unknown | null;
  reload: () => void;
  runtime?: () => CloudRuntime | undefined;
  crypto?: Crypto;
  now?: () => number;
  timeoutMs?: number;
}
export interface BackupRow { uuid: string; name: string; deviceId: string; revision: number; summary: string; verified: boolean }
export interface CloudState {
  status: 'idle' | 'busy' | 'ready' | 'error' | 'conflict' | 'restored';
  code: string | null;
  auto: boolean;
  lastLocalSavedAt: number | null;
  lastCloudSavedAt: number | null;
  backups: BackupRow[];
  retryAt: number | null;
  errno?: number | null;
  localRecoveryCount: number;
}
export type CloudResult = { ok: true; uuid?: string } | { ok: false; code: string; errno?: number };
type Archive = { uuid: string; fileId: string; name: string; summary?: string };
type Envelope = { format: 'taptap-raw-save/1'; appId: string; schema: string | number; deviceId: string; revision: number; savedAt: number; payload: RawSnapshot; payloadSha256: string };
type Anchor = { uuid: string; seen: string[]; payloadSha256: string };
type Meta = { v: 1; deviceId: string; revision: number; lastAttempt: number | null; lastLocal: number | null; lastCloud: number | null; anchor: Anchor | null; auto: boolean };
type Journal = { format: 'taptap-save-journal/1'; appId: string; schema: string | number; phase: 'prepared' | 'applying' | 'committed' | 'rollback-required'; before: RawSnapshot; after: RawSnapshot };
const FORMAT = 'taptap-raw-save/1';
const MIN_UPLOAD_MS = 75_000;
class CloudError extends Error { code: string; errno?: number; constructor(code: string, errno?: number) { super(code); this.code = code; this.errno = errno; } }
function fail(code: string): never { throw new CloudError(code); }
const codeOf = (error: unknown) => error instanceof CloudError ? error.code : 'UNEXPECTED';
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const canonical = (raw: RawSnapshot) => JSON.stringify(Object.fromEntries(Object.keys(raw).sort().map(k => [k, raw[k]])));
export const cloudJournalKey = (appId: string) => `taptap-cloud:${appId}:journal`;
const recoveryPrefix = (appId: string) => `taptap-cloud:${appId}:before-restore:`;
const recoveryIndexKey = (appId: string) => `taptap-cloud:${appId}:before-restore-index`;
const metaKey = (appId: string) => `taptap-cloud:${appId}:meta`;
function keyShape(raw: unknown, keys: readonly SaveKey[]): raw is RawSnapshot {
  return object(raw) && Object.keys(raw).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(raw, k.key) && (typeof raw[k.key] === 'string' || raw[k.key] === null));
}
function readRaw(storage: StoragePort, keys: readonly SaveKey[]): RawSnapshot {
  try { return Object.fromEntries(keys.map(k => [k.key, storage.getItem(k.key)])); } catch { return fail('LOCAL_READ'); }
}
function writeRaw(storage: StoragePort, raw: RawSnapshot, keys: readonly SaveKey[]) {
  for (const { key } of keys) {
    try { if (raw[key] === null) storage.removeItem(key); else storage.setItem(key, raw[key]!); } catch { fail('LOCAL_WRITE'); }
  }
  if (canonical(readRaw(storage, keys)) !== canonical(raw)) fail('LOCAL_VERIFY');
}
/** Call before any store load. Interrupted restores roll back opaque original bytes, never defaults. */
export function recoverCloudJournal(config: Pick<CloudConfig, 'appId' | 'keys' | 'storage'> & Partial<Pick<CloudConfig, 'schema' | 'validate'>>): { status: 'none' | 'recovered' | 'committed' | 'blocked'; code?: string } {
  const { storage, appId, keys } = config;
  try {
    let text: string | null;
    try { text = storage.getItem(cloudJournalKey(appId)); } catch { return { status: 'blocked', code: 'LOCAL_READ' }; }
    if (text === null) return { status: 'none' };
    let j: Journal;
    try { j = JSON.parse(text); } catch { return { status: 'blocked', code: 'JOURNAL_INVALID' }; }
    if (!object(j) || j.format !== 'taptap-save-journal/1' || j.appId !== appId || !['prepared', 'applying', 'committed', 'rollback-required'].includes(j.phase) || !keyShape(j.before, keys) || !keyShape(j.after, keys)) return { status: 'blocked', code: 'JOURNAL_INVALID' };
    if (config.schema !== undefined && j.schema !== config.schema) return { status: 'blocked', code: 'WRONG_SCHEMA' };
    if (j.phase === 'committed' && config.validate) { try { if (!config.validate(j.after)) return { status: 'blocked', code: 'INVALID_PAYLOAD' }; } catch { return { status: 'blocked', code: 'INVALID_PAYLOAD' }; } }
    const committed = j.phase === 'committed';
    if (committed && canonical(readRaw(storage, keys)) !== canonical(j.after)) return { status: 'blocked', code: 'JOURNAL_COMMITTED_CHANGED' };
    if (!committed) writeRaw(storage, j.before, keys);
    storage.removeItem(cloudJournalKey(appId));
    if (storage.getItem(cloudJournalKey(appId)) !== null) fail('JOURNAL_WRITE');
    return { status: committed ? 'committed' : 'recovered' };
  } catch (e) { return { status: 'blocked', code: codeOf(e) }; }
}
export function hasCloudJournal(storage: StoragePort, appId: string): boolean {
  try { return storage.getItem(cloudJournalKey(appId)) !== null; } catch { return true; }
}
/** Each callback owns its timer. Duplicate/late callbacks cannot finish a newer operation. */
export function nativeCall<T>(invoke: (options: NativeOptions) => void, fields: Record<string, unknown>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean, value: unknown) => { if (settled) return; settled = true; clearTimeout(timer); if (ok) resolve(value as T); else reject(value); };
    const timer = setTimeout(() => finish(false, new CloudError('SDK_TIMEOUT')), timeoutMs);
    try { invoke({ ...fields, success: value => finish(true, value), fail: error => { const errno = object(error) && [400000,400001,400002,400003,400007,400009,400100,400101,400200,400201,400202].includes(error.errno) ? error.errno : undefined; finish(false, new CloudError('SDK_FAILURE', errno)); } }); }
    catch { finish(false, new CloudError('SDK_THROW')); }
  });
}

export class CloudSaveController {
  private c: CloudConfig;
  private meta: Meta;
  private state: CloudState;
  private listeners = new Set<(s: CloudState) => void>();
  private busy = false;
  private backupPromise: Promise<CloudResult> | null = null;
  private epoch = 0;
  private stopped = false;
  private dirty = false;
  private verifiedRaw: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private verified = new Set<string>();
  private ticket: { raw: string; ids: string[]; account: unknown; epoch: number; localRevision: unknown } | null = null;
  private releaseWriteLock: (() => void) | null = null;
  constructor(config: CloudConfig) {
    this.c = config;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(config.appId) || !config.keys.length || new Set(config.keys.map(k => k.key)).size !== config.keys.length || !config.keys.some(k => k.required)) throw new Error('Cloud configuration needs an appId, unique whitelist and a required primary key');
    this.meta = { v: 1, deviceId: '', revision: 0, lastAttempt: null, lastLocal: null, lastCloud: null, anchor: null, auto: false };
    let initialError: string | null = null;
    try {
      const text = config.storage.getItem(metaKey(config.appId));
      if (text !== null) {
        const m = JSON.parse(text);
        if (!object(m) || m.v !== 1 || typeof m.deviceId !== 'string' || (m.deviceId !== '' && !/^[a-f0-9]{16}$/.test(m.deviceId)) || !integer(m.revision) || ![m.lastAttempt, m.lastLocal, m.lastCloud].every(t => t === null || integer(t)) || !(m.anchor === null || object(m.anchor) && typeof m.anchor.uuid === 'string' && Array.isArray(m.anchor.seen) && m.anchor.seen.every((id: unknown) => typeof id === 'string') && typeof m.anchor.payloadSha256 === 'string')) fail('META_INVALID');
        // Auto never starts during boot merely because an old preference exists.
        this.meta = { v: 1, deviceId: m.deviceId, revision: m.revision, lastAttempt: m.lastAttempt, lastLocal: m.lastLocal, lastCloud: m.lastCloud, anchor: m.anchor, auto: false };
      }
    } catch (e) { initialError = e instanceof SyntaxError ? 'META_INVALID' : codeOf(e) === 'UNEXPECTED' ? 'LOCAL_READ' : codeOf(e); }
    this.state = { status: initialError ? 'error' : 'idle', code: initialError, auto: false, lastLocalSavedAt: this.meta.lastLocal, lastCloudSavedAt: this.meta.lastCloud, backups: [], retryAt: null, errno: null, localRecoveryCount: this.localRecoveryIds().length };
  }
  getState(): CloudState { return { ...this.state, backups: this.state.backups.map(x => ({ ...x })) }; }
  subscribe(listener: (s: CloudState) => void): () => void { this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener); }
  private emit(status?: CloudState['status'], code: string | null = null, errno: number | null = null) {
    if (status) this.state.status = status; this.state.code = code; this.state.errno = errno; this.state.auto = this.meta.auto;
    this.state.lastLocalSavedAt = this.meta.lastLocal; this.state.lastCloudSavedAt = this.meta.lastCloud;
    for (const f of this.listeners) { try { f(this.getState()); } catch { /* UI observers cannot change backup outcome. */ } }
  }
  private localRecoveryIds(): string[] {
    const prefix = recoveryPrefix(this.c.appId), ids = new Set<string>();
    try {
      const text = this.c.storage.getItem(recoveryIndexKey(this.c.appId));
      if (text !== null) { const index = JSON.parse(text); if (object(index) && index.format === 'taptap-before-restore-index/1' && index.appId === this.c.appId && Array.isArray(index.ids)) for (const id of index.ids) if (typeof id === 'string' && id.startsWith(prefix)) ids.add(id); }
      // Real Storage can also find an immutable backup left by an interrupted index write.
      if (typeof this.c.storage.length === 'number' && this.c.storage.key) for (let i = 0; i < this.c.storage.length; i++) { const id = this.c.storage.key(i); if (id?.startsWith(prefix)) ids.add(id); }
    } catch { /* Export must remain non-destructive when storage cannot be enumerated. */ }
    return Array.from(ids);
  }
  /** Player-initiated offline export; raw before bytes survive even when they were corrupt/future schema. */
  exportLocalRecovery(): string | null {
    try {
      const records = this.localRecoveryIds().map(id => ({ id, raw: this.c.storage.getItem(id) })).filter(x => x.raw !== null);
      return records.length ? JSON.stringify({ format: 'taptap-local-recovery-export/1', appId: this.c.appId, records }) : null;
    } catch { this.emit('error', 'LOCAL_READ'); return null; }
  }
  private async preserveBefore(raw: RawSnapshot, s: ReturnType<CloudSaveController['session']>) {
    const payloadSha256 = await this.digest(raw); s.check();
    const nonce = Array.from(this.crypto().getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
    const id = recoveryPrefix(this.c.appId) + nonce;
    const text = JSON.stringify({ format: 'taptap-before-restore/1', appId: this.c.appId, schema: this.c.schema, savedAt: this.now(), payload: raw, payloadSha256 });
    try {
      this.c.storage.setItem(id, text); if (this.c.storage.getItem(id) !== text) fail('LOCAL_BACKUP_WRITE');
      const indexText = this.c.storage.getItem(recoveryIndexKey(this.c.appId)); let ids: string[] = [];
      if (indexText !== null) { const old = JSON.parse(indexText); if (!object(old) || old.format !== 'taptap-before-restore-index/1' || old.appId !== this.c.appId || !Array.isArray(old.ids) || old.ids.some((x: unknown) => typeof x !== 'string' || !x.startsWith(recoveryPrefix(this.c.appId)))) fail('LOCAL_BACKUP_INVALID'); ids = old.ids; }
      const index = JSON.stringify({ format: 'taptap-before-restore-index/1', appId: this.c.appId, ids: Array.from(new Set([...ids, id])) });
      this.c.storage.setItem(recoveryIndexKey(this.c.appId), index); if (this.c.storage.getItem(recoveryIndexKey(this.c.appId)) !== index) fail('LOCAL_BACKUP_WRITE');
      this.state.localRecoveryCount = this.localRecoveryIds().length;
    } catch (e) { if (e instanceof CloudError) throw e; fail('LOCAL_BACKUP_WRITE'); }
  }
  private now() { return (this.c.now ?? Date.now)(); }
  private crypto() { const c = this.c.crypto ?? globalThis.crypto; if (!c?.subtle || !c.getRandomValues) fail('HASH_UNAVAILABLE'); return c; }
  private async digest(raw: RawSnapshot) { const b = await this.crypto().subtle.digest('SHA-256', new TextEncoder().encode(canonical(raw))); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); }
  private persist() { try { this.c.storage.setItem(metaKey(this.c.appId), JSON.stringify(this.meta)); } catch { fail('LOCAL_WRITE'); } }
  private snapshot(validate = true) {
    const raw = readRaw(this.c.storage, this.c.keys);
    if (validate) {
      if (this.c.readBlocked?.() || hasCloudJournal(this.c.storage, this.c.appId)) fail('LOCAL_BLOCKED');
      if (this.c.keys.some(k => k.required && raw[k.key] === null)) fail('PRIMARY_MISSING');
      let valid = false; try { valid = this.c.validate(raw); } catch { /* Invalid data stays untouched. */ }
      if (!valid) fail('INVALID_PAYLOAD');
    }
    return raw;
  }
  private session() {
    const runtime = this.c.runtime ? this.c.runtime() : (globalThis as unknown as { tap?: CloudRuntime }).tap;
    const account = this.c.accountToken();
    if (!runtime || !runtime.getCloudSaveManager || !runtime.getFileSystemManager || !runtime.env?.USER_DATA_PATH?.startsWith('tapfile://')) fail('SDK_UNAVAILABLE');
    if (account === null || account === undefined) fail('LOGIN_REQUIRED');
    const epoch = this.epoch;
    const check = () => { if (this.stopped || epoch !== this.epoch || account !== this.c.accountToken() || runtime !== (this.c.runtime ? this.c.runtime() : (globalThis as unknown as { tap?: CloudRuntime }).tap)) fail('ACCOUNT_CHANGED'); };
    return { runtime, account, epoch, check };
  }
  private async call<T>(s: ReturnType<CloudSaveController['session']>, invoke: (o: NativeOptions) => void, fields: Record<string, unknown> = {}): Promise<T> { s.check(); const result = await nativeCall<T>(invoke, fields, this.c.timeoutMs ?? 12_000); s.check(); return result; }
  private parseName(name: string) {
    const prefix = `c_${this.c.appId}_`;
    if (!name.startsWith(prefix)) return null;
    const m = /^([a-f0-9]{16})_r([0-9]+)_([a-f0-9]{12})$/.exec(name.slice(prefix.length));
    return m && integer(Number(m[2])) && Number(m[2]) > 0 ? { deviceId: m[1], revision: Number(m[2]), checksum: m[3] } : null;
  }
  private name(e: Envelope) { const name = `c_${this.c.appId}_${e.deviceId}_r${e.revision}_${e.payloadSha256.slice(0, 12)}`; if (new TextEncoder().encode(name).length > 60) fail('ARCHIVE_NAME_TOO_LONG'); return name; }
  private async archives(s: ReturnType<CloudSaveController['session']>): Promise<Archive[]> {
    const manager = s.runtime.getCloudSaveManager();
    const res = await this.call<any>(s, o => manager.getArchiveList(o));
    if (!object(res) || !Array.isArray(res.saves)) fail('LIST_INVALID');
    const rows: Archive[] = res.saves.filter((a: unknown) => object(a) && typeof a.uuid === 'string' && typeof a.fileId === 'string' && typeof a.name === 'string').map((a: any) => ({ uuid: a.uuid, fileId: a.fileId, name: a.name, summary: typeof a.summary === 'string' ? a.summary : '' }));
    return Array.from(new Map(rows.map(a => [a.uuid, a] as const)).values());
  }
  private rows(list: Archive[]) { return list.flatMap(a => { const n = this.parseName(a.name); return n ? [{ uuid: a.uuid, name: a.name, deviceId: n.deviceId, revision: n.revision, summary: (a.summary ?? '').slice(0, 200), verified: this.verified.has(a.uuid) }] : []; }).sort((a, b) => b.revision - a.revision); }
  private async download(s: ReturnType<CloudSaveController['session']>, a: Archive): Promise<Envelope> {
    if (!this.parseName(a.name)) fail('ARCHIVE_NAME');
    const manager = s.runtime.getCloudSaveManager(), fs = s.runtime.getFileSystemManager();
    const nonce = Array.from(this.crypto().getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
    const target = `${s.runtime.env.USER_DATA_PATH}/cloud_${this.c.appId}_read_${nonce}.json`;
    const downloaded = await this.call<any>(s, o => manager.getArchiveData(o), { archiveUUID: a.uuid, archiveFileId: a.fileId, targetFilePath: target });
    if (!object(downloaded) || downloaded.filePath !== target) fail('DOWNLOAD_PATH');
    const file = await this.call<any>(s, o => fs.readFile(o), { filePath: target, encoding: 'utf8' });
    let e: Envelope; try { if (!object(file) || typeof file.data !== 'string' || new TextEncoder().encode(file.data).length > 10_000_000) fail('ENVELOPE_INVALID'); e = JSON.parse(file.data); } catch { return fail('ENVELOPE_INVALID'); }
    if (!object(e) || e.format !== FORMAT) fail('ENVELOPE_INVALID');
    if (e.appId !== this.c.appId) fail('WRONG_APP');
    if (e.schema !== this.c.schema) fail('WRONG_SCHEMA');
    if (!/^[a-f0-9]{16}$/.test(e.deviceId) || !integer(e.revision) || e.revision < 1 || !integer(e.savedAt) || !keyShape(e.payload, this.c.keys) || typeof e.payloadSha256 !== 'string') fail('ENVELOPE_INVALID');
    if (this.c.keys.some(k => k.required && e.payload[k.key] === null)) fail('PRIMARY_MISSING');
    let valid = false; try { valid = this.c.validate(e.payload); } catch { /* Never normalize corrupt cloud bytes. */ }
    if (!valid) fail('INVALID_PAYLOAD');
    if (await this.digest(e.payload) !== e.payloadSha256) fail('CHECKSUM');
    if (this.name(e) !== a.name) fail('ARCHIVE_NAME');
    this.verified.add(a.uuid); return e;
  }
  private checkAnchor(list: Archive[]) {
    const a = this.meta.anchor;
    if (!a || !list.some(x => x.uuid === a.uuid)) fail('ACCOUNT_CHANGED');
    if (list.some(x => { const n = this.parseName(x.name); return n && n.deviceId !== this.meta.deviceId && !a.seen.includes(x.uuid); })) fail('CLOUD_CONFLICT');
  }
  private async execute(action: () => Promise<CloudResult>): Promise<CloudResult> {
    if (this.stopped) return { ok: false, code: 'DESTROYED' };
    if (this.busy) return { ok: false, code: 'BUSY' };
    this.busy = true; this.emit('busy');
    try { const result = await action(); if (this.state.status !== 'restored' && this.state.status !== 'conflict') this.emit('ready'); return result; }
    catch (e) { const code = codeOf(e); this.meta.auto = false; this.clearTimer(); if (code === 'ACCOUNT_CHANGED' || code === 'CLOUD_CONFLICT') { this.ticket = null; } const errno = e instanceof CloudError ? e.errno : undefined; this.emit(code === 'CLOUD_CONFLICT' || code === 'ACCOUNT_CHANGED' ? 'conflict' : 'error', code, errno ?? null); return { ok: false, code, ...(errno === undefined ? {} : { errno }) }; }
    finally { this.busy = false; this.schedule(); }
  }
  listBackups(): Promise<CloudResult> {
    return this.execute(async () => { const s = this.session(), raw = this.snapshot(false), localRevision = this.c.localRevision?.(); const list = await this.archives(s); this.ticket = { raw: canonical(raw), ids: list.map(x => x.uuid), account: s.account, epoch: s.epoch, localRevision }; this.state.backups = this.rows(list); return { ok: true }; });
  }
  backup(): Promise<CloudResult> {
    if (this.backupPromise) return this.backupPromise;
    const promise = this.execute(async () => {
      const s = this.session(), raw = this.snapshot();
      this.crypto();
      if (this.meta.lastAttempt !== null && this.now() < this.meta.lastAttempt + MIN_UPLOAD_MS) { this.state.retryAt = this.meta.lastAttempt + MIN_UPLOAD_MS; fail('RATE_LIMIT'); }
      const before = await this.archives(s);
      if (this.meta.auto) this.checkAnchor(before);
      const payloadSha256 = await this.digest(raw);
      if (this.meta.auto && this.meta.anchor?.payloadSha256 === payloadSha256) { this.verifiedRaw = canonical(raw); this.dirty = false; return { ok: true, uuid: this.meta.anchor.uuid }; }
      if (!this.meta.deviceId) this.meta.deviceId = Array.from(this.crypto().getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
      this.meta.revision++; if (!integer(this.meta.revision)) fail('REVISION_LIMIT');
      this.meta.lastAttempt = this.now(); this.persist();
      const e: Envelope = { format: FORMAT, appId: this.c.appId, schema: this.c.schema, deviceId: this.meta.deviceId, revision: this.meta.revision, savedAt: this.now(), payload: raw, payloadSha256 };
      const name = this.name(e), path = `${s.runtime.env.USER_DATA_PATH}/${name}.json`, text = JSON.stringify(e);
      if (new TextEncoder().encode(text).length > 10_000_000) fail('TOO_LARGE');
      const fs = s.runtime.getFileSystemManager(), manager = s.runtime.getCloudSaveManager();
      await this.call(s, o => fs.writeFile(o), { filePath: path, data: text, encoding: 'utf8' });
      const created = await this.call<any>(s, o => manager.createArchive(o), { archiveMetaData: { name, summary: this.c.describe(raw).slice(0, 200), playtime: 0 }, archiveFilePath: path });
      if (!object(created) || typeof created.uuid !== 'string') fail('CREATE_INVALID');
      let after = await this.archives(s);
      const entry = after.find(x => x.uuid === created.uuid);
      if (!entry) fail('CREATE_NOT_LISTED');
      const verified = await this.download(s, entry);
      if (verified.payloadSha256 !== e.payloadSha256 || verified.deviceId !== e.deviceId || verified.revision !== e.revision) fail('READBACK_MISMATCH');
      if (this.meta.auto) this.checkAnchor(after);
      this.meta.lastCloud = this.now(); this.meta.anchor = { uuid: entry.uuid, seen: after.map(x => x.uuid), payloadSha256: e.payloadSha256 }; this.persist();
      this.verifiedRaw = canonical(raw); this.dirty = canonical(this.snapshot(false)) !== this.verifiedRaw; this.state.retryAt = null;
      await this.cleanup(s, after);
      after = await this.archives(s); this.state.backups = this.rows(after);
      return { ok: true, uuid: entry.uuid };
    });
    this.backupPromise = promise; void promise.finally(() => { if (this.backupPromise === promise) this.backupPromise = null; }); return promise;
  }
  private async cleanup(s: ReturnType<CloudSaveController['session']>, list: Archive[]) {
    const manager = s.runtime.getCloudSaveManager(); if (!manager.deleteArchive) return;
    const ours = list.filter(a => this.parseName(a.name)?.deviceId === this.meta.deviceId).sort((a, b) => this.parseName(b.name)!.revision - this.parseName(a.name)!.revision);
    if (ours.length <= 3) return;
    const valid: Archive[] = [];
    for (const a of ours) { try { const e = await this.download(s, a); if (e.deviceId === this.meta.deviceId) valid.push(a); } catch { s.check(); /* Unknown/corrupt archives are never cleanup targets. */ } }
    // Keep three verified snapshots. Unknown formats and every other device remain untouched.
    for (const a of valid.slice(3)) {
      if (valid.length < 3 || a.uuid === this.meta.anchor?.uuid) continue;
      try { await this.call(s, o => manager.deleteArchive!(o), { archiveUUID: a.uuid }); } catch { s.check(); /* Cleanup failure cannot undo a verified immutable backup. */ }
    }
  }
  restore(uuid: string, confirmation: { confirm: true }): Promise<CloudResult> {
    return this.execute(async () => {
      if (confirmation?.confirm !== true) fail('CONFIRM_REQUIRED');
      const ticket = this.ticket; if (!ticket || !ticket.ids.includes(uuid)) fail('LIST_REQUIRED');
      const s = this.session(); if (ticket.account !== s.account || ticket.epoch !== s.epoch) fail('ACCOUNT_CHANGED');
      const list = await this.archives(s), entry = list.find(a => a.uuid === uuid); if (!entry) fail('ACCOUNT_CHANGED');
      const e = await this.download(s, entry);
      if (canonical(this.snapshot(false)) !== ticket.raw || this.c.localRevision?.() !== ticket.localRevision) fail('LOCAL_CHANGED');
      if (hasCloudJournal(this.c.storage, this.c.appId)) fail('JOURNAL_PENDING');
      this.releaseWriteLock = this.c.lockWrites();
      let before: RawSnapshot;
      try { before = this.snapshot(false); if (canonical(before) !== ticket.raw || this.c.localRevision?.() !== ticket.localRevision) fail('LOCAL_CHANGED'); await this.preserveBefore(before, s); if (canonical(this.snapshot(false)) !== ticket.raw || this.c.localRevision?.() !== ticket.localRevision) fail('LOCAL_CHANGED'); }
      catch (e) { this.releaseWriteLock?.(); this.releaseWriteLock = null; throw e; }
      const key = cloudJournalKey(this.c.appId), journal: Journal = { format: 'taptap-save-journal/1', appId: this.c.appId, schema: this.c.schema, phase: 'prepared', before, after: e.payload };
      const saveJournal = () => { try { const text = JSON.stringify(journal); this.c.storage.setItem(key, text); if (this.c.storage.getItem(key) !== text) fail('JOURNAL_WRITE'); } catch { fail('JOURNAL_WRITE'); } };
      try {
        saveJournal(); journal.phase = 'applying'; saveJournal(); s.check();
        writeRaw(this.c.storage, e.payload, this.c.keys); journal.phase = 'committed'; saveJournal();
        this.c.storage.removeItem(key); if (this.c.storage.getItem(key) !== null) fail('JOURNAL_WRITE');
      } catch (error) {
        try { journal.phase = 'rollback-required'; try { saveJournal(); } catch { /* The existing prepared/applying journal still has the original bytes. */ } writeRaw(this.c.storage, before, this.c.keys); this.c.storage.removeItem(key); if (this.c.storage.getItem(key) !== null) fail('JOURNAL_WRITE'); this.releaseWriteLock?.(); this.releaseWriteLock = null; }
        catch { this.meta.auto = false; fail('ROLLBACK_BLOCKED'); }
        throw error;
      }
      this.meta.auto = false; this.clearTimer(); this.ticket = null; this.verifiedRaw = canonical(e.payload);
      this.meta.lastLocal = this.now(); this.meta.lastCloud = this.now();
      this.meta.anchor = { uuid: entry.uuid, seen: list.map(x => x.uuid), payloadSha256: e.payloadSha256 };
      try { this.persist(); } catch { /* Restore is committed, but auto remains disabled. */ }
      this.emit('restored');
      try { this.c.reload(); } catch { this.emit('restored', 'RELOAD_REQUIRED'); }
      // Successful restore intentionally keeps the app write barrier until reload.
      return { ok: true, uuid };
    });
  }
  async setAutoEnabled(enabled: boolean): Promise<CloudResult> {
    if (!enabled) { this.meta.auto = false; this.clearTimer(); try { this.persist(); } catch { /* The in-memory stop is sufficient. */ } this.emit('ready'); return { ok: true }; }
    return this.execute(async () => { const s = this.session(), raw = this.snapshot(); this.checkAnchor(await this.archives(s)); this.meta.auto = true; this.persist(); this.dirty = await this.digest(raw) !== this.meta.anchor!.payloadSha256; if (!this.dirty) this.verifiedRaw = canonical(raw); return { ok: true }; });
  }
  /** Call only after the game's local write was acknowledged. */
  notifyLocalSaved() { if (this.stopped || this.releaseWriteLock) return; this.meta.lastLocal = this.now(); try { this.dirty = this.verifiedRaw === null || canonical(this.snapshot(false)) !== this.verifiedRaw; } catch { this.meta.auto = false; this.clearTimer(); this.emit('error', 'LOCAL_READ'); return; } try { this.persist(); } catch { this.meta.auto = false; this.clearTimer(); this.emit('error', 'LOCAL_WRITE'); return; } this.emit(); this.schedule(); }
  invalidateAccount() { this.epoch++; this.ticket = null; this.meta.auto = false; this.clearTimer(); this.emit('conflict', 'ACCOUNT_CHANGED'); }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule() {
    this.clearTimer(); if (this.stopped || this.busy || !this.meta.auto || !this.dirty) return;
    const wait = Math.max(1, (this.meta.lastAttempt ?? -MIN_UPLOAD_MS) + MIN_UPLOAD_MS - this.now());
    this.timer = setTimeout(() => { this.timer = null; void this.backup(); }, wait);
  }
  destroy() { this.stopped = true; this.epoch++; this.clearTimer(); this.listeners.clear(); /* Do not release a committed restore's write barrier. */ }
}
export const createCloudSaveController = (config: CloudConfig) => new CloudSaveController(config);

function cloudMessage(s: CloudState) {
  if (s.status === 'restored') return '整份存档已恢复，请重新加载游戏。';
  if (s.status === 'busy') return '正在处理，请稍候…';
  if (!s.code) return '首次请主动备份或选择恢复；不会自动覆盖本机进度。';
  if (s.errno === 400003) return '云端空间不足，本机进度保留。';
  if (s.errno === 400001 || s.code === 'RATE_LIMIT') return '备份间隔较短，请稍后重试。本机进度保留。';
  if (s.code === 'SDK_UNAVAILABLE' || s.code === 'LOGIN_REQUIRED') return '请在TapTap中完成登录后使用云存档。';
  if (s.code === 'ACCOUNT_CHANGED' || s.code === 'CLOUD_CONFLICT') return '账号或云端进度有变化，自动备份已停止。请刷新列表后选择整份进度。';
  if (s.code === 'LOCAL_CHANGED') return '本机进度已有变化。请刷新备份列表后重新选择。';
  if (['WRONG_APP','WRONG_SCHEMA','CHECKSUM','INVALID_PAYLOAD'].includes(s.code)) return '备份与当前游戏不兼容或未通过校验，本机进度未替换。';
  if (['ROLLBACK_BLOCKED','JOURNAL_PENDING','RELOAD_REQUIRED'].includes(s.code)) return '恢复尚未完成，已暂停写入。请保留本机记录并重新加载。';
  if (['LOCAL_READ','LOCAL_BLOCKED','LOCAL_WRITE','LOCAL_BACKUP_WRITE','LOCAL_BACKUP_INVALID'].includes(s.code)) return '本机记录暂时无法安全读写，已停止操作。原记录保留，请稍后重试。';
  return '操作未完成，本机进度保留。请稍后重试。';
}

/** Small framework-free settings surface. All labels use textContent, never HTML from cloud metadata. */
export type DesktopShortcutResult = 'added' | 'already-added' | 'cancelled' | 'unavailable' | 'failed' | 'timeout';
export interface DesktopShortcutHost { createHomeScreenWidget?(options: {success(result?: unknown): void; fail(error?: {errno?: number}): void}): unknown }
/** Only an SDK callback confirms creation; a resolved return value is not confirmation. */
export function createDesktopShortcut(host: DesktopShortcutHost | undefined, timeoutMs = 12000): Promise<DesktopShortcutResult> {
 return new Promise(resolve => {
  if(typeof host?.createHomeScreenWidget !== 'function'){resolve('unavailable');return;}
  let finished=false;
  const finish=(result:DesktopShortcutResult)=>{if(finished)return;finished=true;clearTimeout(timer);resolve(result);};
  const timer=setTimeout(()=>finish('timeout'),timeoutMs);
  try{host.createHomeScreenWidget({success:()=>finish('added'),fail:error=>finish(error?.errno===1518002?'already-added':error?.errno===1518003?'cancelled':'failed')});}catch{finish('failed');}
 });
}

export function mountCloudControls(container: HTMLElement, controller: CloudSaveController): () => void {
  const root = document.createElement('section'); root.className = 'taptap-cloud-controls'; root.style.cssText = 'padding:12px 0;text-align:left;font-size:13px;line-height:1.6';
  const title = document.createElement('b'); title.textContent = '云存档';
  const desktop=document.createElement('button'),desktopStatus=document.createElement('p');desktop.textContent='添加到桌面';let disposed=false;
  desktop.onclick=()=>{desktop.disabled=true;void createDesktopShortcut((globalThis as {tap?:DesktopShortcutHost}).tap).then(result=>{if(disposed)return;desktop.disabled=false;desktopStatus.textContent=({added:'已添加到桌面快捷启动。','already-added':'已在桌面快捷启动中。',cancelled:'已取消添加，可稍后重试。',unavailable:'请在 TapTap 中打开后添加到桌面。',failed:'暂时无法添加，请稍后重试。',timeout:'平台暂未确认，请检查桌面后重试。'} as const)[result];});};
  const status = document.createElement('p'), local = document.createElement('p'), remote = document.createElement('p'), list = document.createElement('div');
  const backup = document.createElement('button'), refresh = document.createElement('button'), auto = document.createElement('button'), exportLocal = document.createElement('button');
  exportLocal.textContent = '导出恢复前本机备份'; backup.textContent = '备份本机进度'; refresh.textContent = '查看云端备份'; auto.textContent = '开启自动备份';
  for (const b of [backup, refresh, auto, exportLocal, desktop]) b.style.cssText = 'min-height:44px;margin:4px;padding:8px 12px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;font:inherit';
  backup.onclick = () => { void controller.backup(); }; refresh.onclick = () => { void controller.listBackups(); }; auto.onclick = () => { void controller.setAutoEnabled(!controller.getState().auto); };
  exportLocal.onclick = () => { const data = controller.exportLocalRecovery(); if (!data) return; const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'before-restore-backups.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  root.append(title, status, local, remote, backup, refresh, auto, exportLocal, list, desktop, desktopStatus); container.append(root);
  const unsubscribe = controller.subscribe(s => {
    status.textContent = cloudMessage(s);
    local.textContent = `本机最后成功保存：${s.lastLocalSavedAt === null ? '尚无记录' : new Date(s.lastLocalSavedAt).toLocaleString()}`;
    remote.textContent = `云端最后验证成功：${s.lastCloudSavedAt === null ? '尚无记录' : new Date(s.lastCloudSavedAt).toLocaleString()}`;
    for (const b of [backup, refresh, auto]) b.disabled = s.status === 'busy' || s.status === 'restored';
    exportLocal.disabled = s.status === 'busy' || !s.localRecoveryCount;
    auto.textContent = s.auto ? '关闭自动备份' : '开启自动备份'; list.replaceChildren();
    for (const a of s.backups) {
      const row = document.createElement('div'), label = document.createElement('p'), choose = document.createElement('button');
      label.textContent = `${a.summary || '云端快照'} · 版本 ${a.revision}${a.verified ? ' · 已核验' : ' · 恢复前将核验'}`; choose.textContent = '选择整份恢复'; choose.style.cssText = backup.style.cssText; choose.disabled = s.status === 'busy';
      choose.onclick = () => { const confirm = document.createElement('button'); confirm.textContent = '确认替换本机整份进度'; confirm.style.cssText = backup.style.cssText; confirm.onclick = () => { void controller.restore(a.uuid, { confirm: true }); }; row.append(confirm); choose.disabled = true; };
      row.append(label, choose); list.append(row);
    }
  });
  return () => { disposed=true; unsubscribe(); root.remove(); };
}
