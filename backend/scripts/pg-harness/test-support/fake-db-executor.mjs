// Bộ thực thi GIẢ trong bộ nhớ cho test (F-02). Không I/O: không mạng, không DB, không Prisma, không process.env.
// Ghi lại mọi lời gọi để test khẳng định thứ tự; trả bằng chứng do test dựng. KHÔNG được import từ mã sản xuất.
const clone = (v) => (v === undefined ? v : structuredClone(v));

export class FakeDbExecutor {
  /** @param {{owner:object, app:object, connection?:object, throwOn?:string}} script */
  constructor(script) {
    this.script = script;
    this.calls = [];
  }

  async readIdentity(role) {
    this.calls.push({ method: 'readIdentity', role });
    if (this.script.throwOn === 'readIdentity') throw new Error('mô phỏng lỗi (có thể chứa postgresql://u:pw@h/db)');
    const snap = clone(this.script[role]);
    return snap && this.script.connection ? { ...snap, connection: clone(this.script.connection) } : snap;
  }

  async migrateDeploy(db) {
    this.calls.push({ method: 'migrateDeploy', db });
    return { applied: 0, simulated: true };
  }
}

const STAMP = '20261024_120000';
export const FAKE = {
  STAMP,
  DB: `siscom_crm_test_${STAMP}`,
  OWNER: `siscom_t_owner_${STAMP}`,
  APP: `siscom_t_app_${STAMP}`,
  PORT: 55432,
  CREATED: '2026-10-24T12:00:00Z',
};

/** Bằng chứng hợp lệ mẫu cho một vai (test sửa từng trường để dựng ca âm). */
export function goodSnapshot(role, o = {}) {
  const user = role === 'owner' ? FAKE.OWNER : FAKE.APP;
  return {
    currentDatabase: FAKE.DB, currentUser: user, sessionUser: user, sessionIsSuperuser: 'off', rolcanlogin: true,
    rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false,
    dbOwner: FAKE.OWNER, dbLabel: `SISCOM_DISPOSABLE_TEST:${STAMP}:${FAKE.CREATED}`,
    serverAddr: '127.0.0.1', serverPort: FAKE.PORT, nonDemoRowCount: 0, ...o,
  };
}
