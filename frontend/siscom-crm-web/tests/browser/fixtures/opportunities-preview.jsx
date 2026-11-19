// Trang XEM THỬ màn hình Cơ hội (Sales S10b) với API GIẢ trong bộ nhớ — không backend, không DB, không đăng nhập, không lưu gì.
// Chạy: npx vite  rồi mở  http://localhost:5173/tests/browser/fixtures/opportunities-preview.html
// Dùng nguyên văn OpportunitiesPage / OpportunityView và controller thật (createCustomerApiUi) qua fetch giả. Đổi vai trò, Sáng/Tối ngay trên trang;
// thu hẹp cửa sổ ≤ 768 px để xem bản điện thoại. KHÔNG phải bằng chứng nghiệm thu với máy chủ thật: quyền ở đây chỉ là dữ liệu mẫu của trang thử.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/styles/styles.css';
import '../../../src/styles/app.css';
import { Toast } from '../../../src/ds/index.js';
import { createCustomerApiUi } from '../../../src/features/customers/customerApiUi.js';
import OpportunitiesPage, { OpportunityView } from '../../../src/features/opportunities/OpportunitiesPage.jsx';
import { parseOpportunitiesRoute } from '../../../src/features/opportunities/opportunitiesModel.js';

const ME = 'e-me'; const CID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const all = (keys, scope) => Object.fromEntries(keys.map((k) => [k, scope]));
const ROLES = {
  sales: { label: 'Kinh doanh', perms: { 'customer.read': 'OWN', ...all(['opportunity.read', 'opportunity.create', 'opportunity.update', 'opportunity.move_stage', 'opportunity.close', 'opportunity.assign'], 'OWN') } },
  admin: { label: 'Quản trị CRM', perms: all(['customer.read', 'opportunity.read', 'opportunity.create', 'opportunity.update', 'opportunity.move_stage', 'opportunity.close', 'opportunity.assign', 'opportunity.reopen', 'opportunity.delete', 'opportunity.restore'], 'ALL') },
  acct: { label: 'Kế toán', perms: { 'customer.read': 'ALL', 'opportunity.read': 'ALL' } },
  tech: { label: 'Kỹ thuật', perms: { 'opportunity.read_assigned': 'OWN' } },
};
const META = {
  stages: [['s1', 'PROSPECTING', 'Tiếp cận', 10], ['s2', 'SURVEY', 'Khảo sát', 25], ['s3', 'QUOTATION', 'Báo giá', 45], ['s4', 'NEGOTIATION', 'Đàm phán', 70]].map(([id, code, label, defaultProbability]) => ({ id, code, label, defaultProbability })),
  types: [['t1', 'SUPPLY', 'Cung cấp thiết bị, vật tư', false], ['t2', 'INSTALLATION', 'Thi công', true], ['t3', 'SUPPLY_INSTALLATION', 'Cung cấp và thi công', true]].map(([id, code, label, requiresProject]) => ({ id, code, label, requiresProject })),
  lostReasons: [['r1', 'PRICE_HIGHER', 'Giá cao hơn đối thủ', false], ['r2', 'NO_RESPONSE', 'Khách không phản hồi', false], ['r9', 'OTHER', 'Khác (kèm ghi chú)', true]].map(([id, code, label, requiresNote]) => ({ id, code, label, requiresNote })),
};
const PEOPLE = [{ id: 'e2', code: 'NV-0002', fullName: 'Lê Thị Hai', departmentCode: 'KD' }, { id: 'e7', code: 'NV-0007', fullName: 'Phạm Kỹ Thuật', departmentCode: 'KT' }];
const OWNERS = [{ id: ME, code: 'NV-0003', fullName: 'Trần Bình' }, { id: 'e2', code: 'NV-0002', fullName: 'Lê Thị Hai' }];
const lookup = (list, id) => { const x = list.find((y) => y.id === id); return { id: x.id, code: x.code, label: x.label }; };
const now = () => new Date().toISOString();
const TITLES = ['Chiller trung tâm dữ liệu GĐ1', 'Bán 120 FCU khách sạn', 'VRV toà văn phòng', 'Thay AHU nhà máy', 'Bảo trì hệ thống lạnh', 'Ống gió tầng hầm'];
let seq = 0;
const make = (over = {}) => { const n = ++seq; const type = META.types[n % 3]; const linked = type.requiresProject; return {
  id: 'o' + n, code: 'CH-' + String(n).padStart(4, '0'), title: TITLES[n % TITLES.length] + ' #' + n, status: 'OPEN', type: lookup(META.types, type.id), stage: lookup(META.stages, META.stages[n % 4].id),
  customer: { id: CID, code: 'KH-00478', name: 'Công ty CP Cơ điện Sao Mai' }, owner: OWNERS[n % 2], needSummary: n % 4 ? 'Khách cần báo giá trong tháng.' : null, isProjectLinked: linked, projectName: linked ? 'Dự án mẫu ' + n : null, offerScope: linked ? 'Cung cấp và lắp đặt' : null,
  expectedAmountVnd: n % 3 === 0 ? null : String(n * 185000000), probability: META.stages[n % 4].defaultProbability, probabilityOverridden: false, expectedCloseDate: n % 5 === 0 ? null : (n % 4 === 0 ? '2026-10-1' + (n % 9) : '2026-12-' + String(10 + (n % 18)).padStart(2, '0')),
  holdUntil: null, holdReason: null, wonAmountVnd: null, wonDocType: null, wonDocNo: null, wonDocDate: null, wonDocUrl: null, wonDocFileName: null, lostReason: null, lostNote: null, closedAt: null, deletedAt: null, contactId: null, version: 1, createdAt: now(), updatedAt: now(), ...over }; };
const DB = Array.from({ length: 45 }, () => make());
Object.assign(DB[2], { status: 'ON_HOLD', holdUntil: '2026-12-01', holdReason: 'Chờ ngân sách năm sau' });
Object.assign(DB[5], { status: 'WON', wonAmountVnd: '980000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-2026-118', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/hd-118', wonDocFileName: 'hd-2026-118.pdf', closedAt: now() });
Object.assign(DB[8], { status: 'LOST', lostReason: lookup(META.lostReasons, 'r1'), closedAt: now() });

const shown = (o, role) => (o.status === 'WON' ? 100 : o.status === 'LOST' ? 0 : o.probability);
const tech = (o, detail) => ({ id: o.id, code: o.code, title: o.title, access: 'TASK', type: o.type, stage: o.stage, customer: { id: o.customer.id, code: o.customer.code, name: o.customer.name }, isProjectLinked: o.isProjectLinked, projectName: o.projectName, expectedCloseDate: o.expectedCloseDate, version: o.version, createdAt: o.createdAt, updatedAt: o.updatedAt, ...(detail ? { needSummary: o.needSummary, offerScope: o.offerScope } : {}) });
const fullOf = (o) => ({ ...o, access: 'FULL', probability: shown(o), customerReadable: true, contact: null });
const state = { role: 'sales', fail: false };
const visible = () => (state.role === 'tech' ? DB.filter((o, i) => !o.deletedAt && i % 9 === 1) : DB.filter((o) => !o.deletedAt && (state.role !== 'sales' || o.owner.id === ME || true)));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fakeFetch = async (url, init = {}) => {
  await new Promise((r) => setTimeout(r, 180));
  const method = init.method || 'GET'; const u = new URL(url, location.origin); const p = u.pathname.replace('/fake-api', ''); const body = init.body ? JSON.parse(init.body) : null; const q = u.searchParams;
  if (state.fail) return json(500, { error: { code: 'INTERNAL', message: 'Máy chủ lỗi (giả lập).' } });
  if (p === '/opportunities/meta') return state.role === 'tech' ? json(403, { error: { code: 'FORBIDDEN', message: 'Không có quyền.' } }) : json(200, { data: META });
  if (p === '/customers') return json(200, { data: { items: [{ id: CID, code: 'KH-00478', name: 'Công ty CP Cơ điện Sao Mai', shortName: 'Sao Mai', version: 1 }], page: 1, pageSize: 8, total: 1, totalPages: 1 } });
  if (p === '/opportunities' && method === 'GET') {
    let rows = visible();
    if (q.get('status')) rows = rows.filter((o) => o.status === q.get('status'));
    if (q.get('stageId')) rows = rows.filter((o) => o.stage.id === q.get('stageId'));
    if (q.get('typeId')) rows = rows.filter((o) => o.type.id === q.get('typeId'));
    if (q.get('q')) rows = rows.filter((o) => (o.title + ' ' + (o.projectName || '')).toLowerCase().includes(q.get('q').toLowerCase()));
    const page = Number(q.get('page') || 1); const size = Number(q.get('pageSize') || 20);
    return json(200, { data: { items: rows.slice((page - 1) * size, page * size).map((o) => (state.role === 'tech' ? tech(o) : fullOf(o))), page, pageSize: size, total: rows.length, totalPages: Math.ceil(rows.length / size) } });
  }
  if (p === '/opportunities' && method === 'POST') { const o = make({ title: body.title, type: lookup(META.types, body.typeId), stage: lookup(META.stages, 's1'), probability: 10, owner: OWNERS[0], isProjectLinked: !!body.isProjectLinked, projectName: body.projectName || null, offerScope: body.offerScope || null, needSummary: body.needSummary || null, expectedAmountVnd: body.expectedAmountVnd || null, expectedCloseDate: body.expectedCloseDate || null }); DB.unshift(o); return json(201, { data: fullOf(o) }); }
  const m = /^\/opportunities\/([^/]+)(\/[a-z-]+)?$/.exec(p);
  const o = m ? visible().find((x) => x.id === decodeURIComponent(m[1])) : null;
  if (!o) return json(404, { error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Không tìm thấy cơ hội.' } });
  if (method === 'GET' && /-candidates$/.test(m[2] || '')) return json(200, { data: { items: PEOPLE } });
  if (method === 'GET') return json(200, { data: state.role === 'tech' ? tech(o, true) : fullOf(o) });
  if (body.version !== o.version) return json(409, { error: { code: 'OPPORTUNITY_VERSION_CONFLICT', message: 'Cơ hội đã được người khác thay đổi.' } });
  const act = m[2] || '';
  if (method === 'DELETE') o.deletedAt = now();
  else if (act === '/stage') { const s = META.stages.find((x) => x.id === body.stageId); if (s.code !== 'PROSPECTING' && !o.needSummary) return json(400, { error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu gửi lên không hợp lệ.', details: [{ field: 'needSummary', message: 'Phải ghi nhu cầu của khách trước khi rời giai đoạn Tiếp cận.' }] } }); o.stage = lookup(META.stages, s.id); o.probability = s.defaultProbability; }
  else if (act === '/hold') Object.assign(o, { status: 'ON_HOLD', holdUntil: body.holdUntil, holdReason: body.holdReason });
  else if (act === '/resume') Object.assign(o, { status: 'OPEN', holdUntil: null, holdReason: null });
  else if (act === '/win') Object.assign(o, { status: 'WON', wonAmountVnd: body.wonAmountVnd, wonDocType: body.wonDocType, wonDocNo: body.wonDocNo, wonDocDate: body.wonDocDate, wonDocUrl: body.wonDocUrl, wonDocFileName: body.wonDocFileName || null, closedAt: now() });
  else if (act === '/lose') Object.assign(o, { status: 'LOST', lostReason: lookup(META.lostReasons, body.lostReasonId), lostNote: body.lostNote || null, closedAt: now() });
  else if (act === '/reopen') Object.assign(o, { status: 'OPEN', closedAt: null });
  else if (act === '/assign') { const to = PEOPLE.find((x) => x.id === body.ownerId); o.owner = { id: to.id, code: to.code, fullName: to.fullName }; }
  o.version += 1; o.updatedAt = now();
  return json(200, { data: fullOf(o) });
};

const api = createCustomerApiUi({ env: { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: '/fake-api' }, fetchImpl: fakeFetch });
const routeOf = () => parseOpportunitiesRoute((location.hash || '#/pipeline').replace(/^#\/?/, '').split('/'));

function Preview() {
  const [role, setRole] = React.useState('sales');
  const [theme, setTheme] = React.useState('light');
  const [fail, setFail] = React.useState(false);
  const [route, setRoute] = React.useState(routeOf);
  const [mobile, setMobile] = React.useState(() => window.matchMedia('(max-width: 768px)').matches);
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => { const h = () => setRoute(routeOf()); const r = () => setMobile(window.matchMedia('(max-width: 768px)').matches); window.addEventListener('hashchange', h); window.addEventListener('resize', r); return () => { window.removeEventListener('hashchange', h); window.removeEventListener('resize', r); }; }, []);
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  state.role = role; state.fail = fail;
  const toast = (t) => { const id = Date.now() + Math.random(); setToasts((l) => [...l.slice(-3), { id, ...t }]); setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 4000); };
  const perms = ROLES[role].perms;
  const ui = { customerApi: api, me: { employeeId: ME, permissions: perms }, can: (p) => p in perms, mobile, toast, confirm: () => {}, navigate: (path) => { location.hash = path; } };
  const bar = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px var(--page-gutter)', background: 'var(--warning-soft)', color: 'var(--warning-text)', borderBottom: '1px solid var(--warning-border)', font: 'var(--type-caption)' };
  return (
    <div style={{ minHeight: '100%' }}>
      <div role="note" style={bar}>
        <b>Trang xem thử — API giả, dữ liệu mẫu, không lưu.</b>
        <label>Vai trò <select value={role} onChange={(e) => { setRole(e.target.value); location.hash = '/pipeline'; }}>{Object.keys(ROLES).map((k) => <option key={k} value={k}>{ROLES[k].label}</option>)}</select></label>
        <label>Giao diện <select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="light">Sáng</option><option value="dark">Tối</option></select></label>
        <label><input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} /> Giả lập máy chủ lỗi</label>
      </div>
      <div key={role + ':' + (route.id || 'list')} style={{ padding: 'var(--page-gutter)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
        {route.id ? <OpportunityView ui={ui} id={route.id} /> : <OpportunitiesPage ui={ui} />}
      </div>
      <div className="sg-toast-stack">{toasts.map((t) => <Toast key={t.id} {...t} onClose={() => setToasts((l) => l.filter((x) => x.id !== t.id))} />)}</div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Preview />);
