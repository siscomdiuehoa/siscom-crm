import { APP_DATA } from '../demoData.js';
import { storage } from './storage.js';

export const SCHEMA_VERSION = 2;
export const DB_KEY = 'siscom-crm-db-v2';
export const LEGACY_KEY = 'siscom-crm-demo-v1'; // v1 data: READ ONLY, never modified or deleted
export const BACKUP_PREFIX = 'siscom-crm-backup-';
const MAX_AUTO_BACKUPS = 3;
const clone = (x) => JSON.parse(JSON.stringify(x));
const demo = (r) => ({ ...r, isDemo: true });

export function seedV2() {
  const D = APP_DATA;
  return {
    meta: { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), source: 'demo-seed' },
    customers: clone(D.customers), contacts: clone(D.contacts), interactions: clone(D.interactions),
    quotes: clone(D.quotes).map(demo), contracts: clone(D.contracts).map(demo), projects: clone(D.projects).map(demo),
    opportunities: clone(D.opportunities).map(demo),
    approvals: clone(D.approvals).map((a) => ({ ...a, status: 'Chờ duyệt', isDemo: true })),
    overdue: clone(D.overdue).map(demo), contractAlerts: clone(D.contractAlerts).map(demo),
    auditLog: [],
  };
}

// Migrations are keyed by the version they upgrade FROM. They may only ADD fields/collections — never drop user data.
export const MIGRATIONS = {
  1: (v1) => {
    const s = seedV2();
    return { ...s, customers: v1.customers, contacts: v1.contacts || [], interactions: v1.interactions || [],
      meta: { ...s.meta, source: 'legacy-v1', migratedFrom: 1, migratedAt: new Date().toISOString() } };
  },
};
const versionOf = (d) => (d && d.meta && d.meta.schemaVersion) || 1;
export function migrate(doc) {
  let d = doc; let v = versionOf(d);
  if (v > SCHEMA_VERSION) throw new Error('Dữ liệu thuộc phiên bản mới hơn (v' + v + ') so với ứng dụng (v' + SCHEMA_VERSION + ').');
  while (v < SCHEMA_VERSION) { const step = MIGRATIONS[v]; if (!step) throw new Error('Thiếu bước nâng cấp dữ liệu từ v' + v); d = step(d); v = versionOf(d); }
  validate(d); return d;
}
export function validate(d) {
  const need = ['customers', 'contacts', 'interactions', 'quotes', 'contracts', 'projects', 'opportunities', 'approvals', 'overdue', 'contractAlerts', 'auditLog'];
  if (!d || !d.meta) throw new Error('Thiếu thông tin phiên bản dữ liệu.');
  for (const k of need) if (!Array.isArray(d[k])) throw new Error('Dữ liệu thiếu bảng "' + k + '".');
}

// Backups: tag 'v1' (pre-migration) is never pruned; other tags keep the newest ${MAX_AUTO_BACKUPS}.
export function makeBackup(raw, tag) {
  const key = BACKUP_PREFIX + tag + '-' + new Date().toISOString().replace(/[:.]/g, '-');
  const r = storage.set(key, raw);
  if (r.ok) pruneBackups();
  return { ok: r.ok, key, error: r.error };
}
export function listBackups() { return storage.keys().filter((k) => k.startsWith(BACKUP_PREFIX)).sort(); }
function pruneBackups() {
  const auto = listBackups().filter((k) => !k.startsWith(BACKUP_PREFIX + 'v1-'));
  auto.slice(0, Math.max(0, auto.length - MAX_AUTO_BACKUPS)).forEach((k) => storage.remove(k));
}

// Boot: returns { db, report }. readOnly=true means persistence is disabled so nothing on disk can be overwritten.
export function loadDatabase() {
  const report = { source: 'seed', migrated: false, backupKey: null, readOnly: false, error: null };
  const raw2 = storage.get(DB_KEY);
  if (raw2) {
    try { const db = migrate(JSON.parse(raw2)); report.source = 'v2'; return { db, report }; }
    catch (e) { report.readOnly = true; report.error = 'Không đọc được dữ liệu đã lưu: ' + e.message + ' Dữ liệu gốc được giữ nguyên, chưa ghi đè.'; return { db: seedV2(), report }; }
  }
  const raw1 = storage.get(LEGACY_KEY);
  if (raw1) {
    try {
      const v1 = JSON.parse(raw1);
      if (!v1 || !Array.isArray(v1.customers)) throw new Error('định dạng dữ liệu cũ không hợp lệ.');
      const bk = makeBackup(raw1, 'v1');
      if (!bk.ok) { report.readOnly = true; report.error = 'Không thể sao lưu dữ liệu cũ trước khi nâng cấp (' + bk.error + '). Chưa nâng cấp, dữ liệu cũ được giữ nguyên.'; }
      else report.backupKey = bk.key;
      const db = migrate(v1); report.source = 'legacy-v1'; report.migrated = !report.readOnly;
      return { db, report };
    } catch (e) { report.readOnly = true; report.error = 'Không nâng cấp được dữ liệu cũ: ' + e.message + ' Dữ liệu cũ được giữ nguyên.'; return { db: seedV2(), report }; }
  }
  return { db: seedV2(), report };
}
export function saveDatabase(db) { return storage.set(DB_KEY, JSON.stringify(db)); }

export function buildBackupFile(db) { return JSON.stringify({ app: 'siscom-crm', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: db }, null, 2); }
export function parseBackupFile(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw new Error('File không phải JSON hợp lệ.'); }
  if (!o || o.app !== 'siscom-crm' || !o.data) throw new Error('File không phải bản sao lưu của SISCOM CRM.');
  return migrate(o.data);
}
