import React from 'react';
import { Sidebar, SISCOM_NAV, Topbar, ChatPanel, Toast, EmptyState, Button, Modal, IconButton, Icon, Avatar, Select } from './ds/index.js';
import * as U from './data/util.js';
import { APP_DATA } from './data/demoData.js';
import logo from './assets/logo-siscom.png';
import { loadDatabase, saveDatabase, seedV2, makeBackup, parseBackupFile, storage, DB_KEY, Ops, RepoError } from './data/repository/index.js';
import { DEMO_USERS, ROLES, can as canDo } from './auth/permissions.js';
import DataTools from './features/data/DataTools.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import CustomerListPage from './pages/CustomerList.jsx';
import CustomerProfilePage from './pages/CustomerProfile.jsx';
import CustomerApiDetail from './features/customers/CustomerApiDetail.jsx';
import { createCustomerApiUi } from './features/customers/customerApiUi.js';
import ApiModeUnsupported, { API_UNSUPPORTED_NOTE } from './features/apiMode/ApiModeUnsupported.jsx';

// null unless VITE_CRM_API_ENABLED === 'true' (default OFF = localStorage demo; no network code path is reachable).
const CUSTOMER_API = createCustomerApiUi({ env: import.meta.env });

// API mode never loads, migrates, backs up or saves the localStorage demo database; it starts from an EMPTY in-memory shape (nothing demo can be rendered).
const API_ON = !!CUSTOMER_API;
const EMPTY_DB = { customers: [], contacts: [], interactions: [], quotes: [], contracts: [], projects: [], opportunities: [], overdue: [], approvals: [], contractAlerts: [] };
const NAV = API_ON ? SISCOM_NAV.map(({ badge, ...rest }) => rest) : SISCOM_NAV; // static badges (e.g. 8 opportunities) are demo counts
const STORE = 'siscom-crm-demo-v1';
// Fixed-state mode for QA/screenshots: ?route=/dashboard&theme=dark (no localStorage writes). Normal use: no query string.
const INIT = (() => { const p = new URLSearchParams(location.search); const route = p.get('route'), theme = p.get('theme'); return route || theme ? { route, theme } : null; })();

function parseRoute(h) {
  const p = (h || '').replace(/^#\/?/, '').split('/');
  if (p[0] === 'customers' && p[1]) { let id = p[1]; try { id = decodeURIComponent(id); } catch (e) { /* malformed %-escape: keep the raw text; the id check rejects it, the app must not crash */ } return { page: 'customers', id }; }
  return { page: p[0] || 'dashboard' };
}

function ThemeSwitch({ mode, setMode }) {
  const opts = [['light', 'sun', 'Sáng'], ['dark', 'moon', 'Tối'], ['system', 'monitor', 'Theo hệ thống']];
  const next = opts[(opts.findIndex((o) => o[0] === mode) + 1) % 3];
  return (
    <>
      <div className="app-theme-pill" role="radiogroup" aria-label="Giao diện" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}>
        {opts.map(([v, ic, lb]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} title={'Giao diện: ' + lb} aria-label={'Giao diện ' + lb} onClick={() => setMode(v)}
            style={{ width: 30, height: 28, border: 0, borderRadius: 7, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: mode === v ? 'var(--surface-solid)' : 'transparent', color: mode === v ? 'var(--primary)' : 'var(--text-3)', boxShadow: mode === v ? 'var(--shadow-xs)' : 'none', transition: 'all var(--dur-fast)' }}>
            <Icon name={ic} size={15} />
          </button>
        ))}
      </div>
      <span className="app-theme-cycle"><IconButton icon={opts.find((o) => o[0] === mode)[1]} label={'Đổi giao diện: ' + next[2]} onClick={() => setMode(next[0])} /></span>
    </>
  );
}

function SearchResults({ q, db, onPick }) {
  const [pos, setPos] = React.useState(null);
  React.useEffect(() => { const el = document.querySelector('.sg-search'); if (el) { const r = el.getBoundingClientRect(); setPos({ left: r.left, top: r.bottom + 6, width: Math.max(r.width, 340) }); } }, [q]);
  if (!pos || q.trim().length < 2) return null;
  const n = U.norm(q.trim());
  const hits = db.customers.filter((c) => [c.name, c.short, c.id, c.taxId, c.city].some((v) => U.norm(v).includes(n))).slice(0, 6);
  return (
    <div className="sg-glass-strong" style={{ position: 'fixed', zIndex: 70, left: pos.left, top: pos.top, width: pos.width, maxWidth: 'calc(100vw - 32px)', borderRadius: 12, padding: 6, animation: 'sg-scale-in var(--dur-fast) var(--ease-out)' }}>
      <div style={{ font: 'var(--type-overline)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)', padding: '6px 10px' }}>Khách hàng</div>
      {hits.length ? hits.map((c) => (
        <div key={c.id} className="sg-menu__item" onMouseDown={(e) => { e.preventDefault(); onPick(c.id); }}>
          <Avatar name={c.short} square size={28} />
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.short}</div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{c.id} · MST {c.taxId}</div></div>
        </div>
      )) : <div style={{ padding: '10px', font: 'var(--type-sm)', color: 'var(--text-3)' }}>Không tìm thấy khách hàng phù hợp.</div>}
    </div>
  );
}

function RoleSwitch({ user, setUserId }) {
  return <div className="app-role" title="Tài khoản demo — chỉ để thử phân quyền trên giao diện"><Select size="sm" icon="user-round" value={user.id} onChange={setUserId} options={DEMO_USERS.map((u) => ({ value: u.id, label: u.name + ' · ' + ROLES[u.role].label }))} /></div>;
}

function SiscomCrmApp() {
  const init = INIT;
  const [boot] = React.useState(() => (API_ON ? { db: EMPTY_DB, report: { readOnly: true, error: null, migrated: false } } : init ? { db: seedV2(), report: { readOnly: false, error: null, migrated: false } } : loadDatabase()));
  const [db, setDb] = React.useState(boot.db);
  const [ro, setRo] = React.useState(boot.report.readOnly);
  const dbRef = React.useRef(boot.db);
  const [userId, setUserId] = React.useState(() => { try { return (!init && !API_ON && localStorage.getItem('siscom-crm-demo-user')) || 'u-director'; } catch (e) { return 'u-director'; } });
  const user = DEMO_USERS.find((u) => u.id === userId) || DEMO_USERS[0];
  const userRef = React.useRef(user); userRef.current = user;
  const [route, setRoute] = React.useState(() => (init && init.route ? parseRoute(init.route) : parseRoute(location.hash)));
  const [mode, setMode] = React.useState(() => (init && init.theme) || localStorage.getItem('siscom-crm-theme') || 'system');
  const [sysDark, setSysDark] = React.useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mq = () => window.matchMedia('(max-width: 768px)').matches;
  const [mobile, setMobile] = React.useState(mq());
  const [collapsed, setCollapsed] = React.useState(window.innerWidth < 1280);
  const [navOpen, setNavOpen] = React.useState(false);
  const [chat, setChat] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [toasts, setToasts] = React.useState([]);
  const [dlg, setDlg] = React.useState(null);

  React.useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)'); const h = (e) => setSysDark(e.matches);
    m.addEventListener('change', h);
    const r = () => { setMobile(mq()); if (window.innerWidth < 1280) setCollapsed(true); };
    window.addEventListener('resize', r);
    const hc = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', hc);
    return () => { m.removeEventListener('change', h); window.removeEventListener('resize', r); window.removeEventListener('hashchange', hc); };
  }, []);
  const theme = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); if (!init) localStorage.setItem('siscom-crm-theme', mode); }, [theme, mode]);
  React.useEffect(() => { if (init || API_ON || ro) return; const r = saveDatabase(db); if (!r.ok) toast({ tone: 'error', title: 'Không lưu được dữ liệu', message: r.error === 'quota' ? 'Bộ nhớ trình duyệt đã đầy. Hãy xuất file sao lưu ngay.' : r.error }); }, [db, ro]);
  React.useEffect(() => { if (!init && !API_ON) { try { localStorage.setItem('siscom-crm-demo-user', userId); } catch (e) { /* ignore */ } } }, [userId]);
  React.useEffect(() => { if (boot.report.migrated) toast({ tone: 'success', title: 'Đã nâng cấp dữ liệu lên phiên bản 2', message: 'Dữ liệu khách hàng cũ được giữ nguyên; bản sao lưu: ' + boot.report.backupKey }); }, []);
  React.useEffect(() => { setNavOpen(false); const m = document.querySelector('main'); if (m) m.scrollTop = 0; }, [route.page, route.id]);

  const navigate = (path) => { if (init) setRoute(parseRoute(path)); else location.hash = path; };
  const toast = (t) => { const id = Date.now() + Math.random(); setToasts((l) => [...l.slice(-3), { id, ...t }]); setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 4500); };
  const confirm = (o) => setDlg(o);
  const commit = (fn) => {
    try { const next = fn(dbRef.current, { user: userRef.current }); dbRef.current = next; setDb(next); return { ok: true }; }
    catch (e) { if (e instanceof RepoError) { toast({ tone: 'error', title: e.title || 'Không thực hiện được', message: e.message }); return { ok: false, error: e.message }; } throw e; }
  };
  const backupNow = (tag) => makeBackup(storage.get(DB_KEY) || JSON.stringify(dbRef.current), tag);
  const replaceDb = (next) => { dbRef.current = next; setDb(next); setRo(false); };
  const api = {
    saveCustomer: (c, ct) => commit((d, x) => Ops.saveCustomer(d, c, ct, x)),
    nextId: () => Ops.nextCustomerId(dbRef.current),
    maxCustomerNo: () => Ops.maxCustomerNo(dbRef.current),
    activeLinks: (ids) => Ops.activeLinks(dbRef.current, ids),
    deleteCustomers: (ids) => commit((d, x) => Ops.deleteCustomers(d, ids, x)),
    importCustomers: (list) => commit((d, x) => Ops.importCustomers(d, list, x)),
    saveContact: (ct) => commit((d, x) => Ops.saveContact(d, ct, x)),
    deleteContact: (id) => commit((d, x) => Ops.deleteContact(d, id, x)),
    addInteraction: (it) => commit((d, x) => Ops.addInteraction(d, it, x)),
    decideApproval: (code, ok) => commit((d, x) => Ops.decideApproval(d, code, ok, x)),
  };
  const view = React.useMemo(() => ({ ...db, customers: db.customers.filter((c) => !c.deletedAt) }), [db]);
  const ui = { customerApi: CUSTOMER_API, db: view, api, navigate, toast, confirm, mobile, user, can: (a, rec) => canDo(user, a, rec), openChat: () => setChat(true) };

  const cust = route.id ? db.customers.find((c) => c.id === route.id) : null;
  const navItem = NAV.find((n) => n.id === route.page) || {};
  let title = navItem.label || 'SISCOM CRM', crumbs = ['SISCOM CRM'], body;
  if (API_ON && route.page === 'dashboard') { title = 'Tổng quan điều hành'; crumbs = ['SISCOM CRM', 'Tổng quan']; body = <ApiModeUnsupported title="Tổng quan điều hành" onBack={() => navigate('/customers')} />; }
  else if (route.page === 'dashboard') { title = 'Tổng quan điều hành'; crumbs = ['SISCOM CRM', 'Tổng quan']; body = <DashboardPage ui={ui} />; }
  else if (route.page === 'customers' && route.id && CUSTOMER_API) { title = 'Chi tiết khách hàng'; crumbs = ['SISCOM CRM', 'Khách hàng', 'Chi tiết']; body = <CustomerApiDetail ui={ui} id={route.id} />; }
  else if (route.page === 'customers' && route.id) { title = cust ? cust.short : 'Không tìm thấy'; crumbs = ['SISCOM CRM', 'Khách hàng', route.id]; body = cust ? <CustomerProfilePage ui={ui} c={cust} /> : <div className="sg-card sg-solid"><EmptyState kind="search" title="Không tìm thấy khách hàng" description={'Mã ' + route.id + ' không tồn tại hoặc đã bị xoá.'} action={<Button onClick={() => navigate('/customers')}>Về danh sách</Button>} /></div>; }
  else if (route.page === 'customers') { title = 'Quản lý khách hàng'; crumbs = ['SISCOM CRM', 'Kinh doanh']; body = <CustomerListPage ui={ui} />; }
  else body = <div className="sg-card sg-glass" style={{ marginTop: 24 }}><EmptyState icon={navItem.icon || 'box'} title={(navItem.label || 'Module') + ' — chờ duyệt giai đoạn 1'} description="Module này sẽ được xây dựng sau khi Tổng quan điều hành và Quản lý khách hàng được duyệt." action={<Button onClick={() => navigate('/dashboard')}>Về Tổng quan</Button>} /></div>;

  const sidebar = (extra) => <Sidebar items={NAV} active={route.page} onSelect={(id) => navigate('/' + id)} logoSrc={logo} user={API_ON ? { name: 'Phiên API', role: 'Xác thực do máy chủ quyết định' } : { name: user.name, role: ROLES[user.role].label }} {...extra} />;
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {mobile ? (navOpen ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 64, display: 'flex' }}>
          <div onClick={() => setNavOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--overlay)', animation: 'sg-fade var(--dur-base)' }} />
          <div style={{ position: 'relative', height: '100%', animation: 'sg-fade-up var(--dur-slow) var(--ease-out)' }}>{sidebar({ onToggle: () => setNavOpen(false), className: 'sg-glass-strong' })}</div>
        </div>) : null) : sidebar({ collapsed, onToggle: () => setCollapsed(!collapsed) })}
      <main className="sg-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto', position: 'relative' }}>
        <Topbar title={title} breadcrumbs={crumbs} search={q} onSearch={setQ} notifications={API_ON ? 0 : 5} onAskAI={API_ON ? undefined : () => setChat(true)} onMenu={mobile ? () => setNavOpen(true) : undefined}
          user={{ name: API_ON ? 'Phiên API' : user.name }} actions={<>{API_ON ? null : <RoleSwitch user={user} setUserId={setUserId} />}<ThemeSwitch mode={mode} setMode={setMode} /></>} />
        <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px var(--page-gutter)', font: 'var(--type-caption)', color: 'var(--warning-text)', background: 'var(--warning-soft)', borderBottom: '1px solid var(--warning-border)', flexWrap: 'wrap' }}>
          <Icon name={API_ON ? 'server' : 'flask-conical'} size={14} />
          {API_ON ? <span style={{ flex: 1, minWidth: 200 }}>Chế độ API — chỉ danh sách và chi tiết khách hàng lấy từ máy chủ. Các mô-đun khác {API_UNSUPPORTED_NOTE}; không hiển thị dữ liệu minh hoạ.</span>
            : <span style={{ flex: 1, minWidth: 200 }}>Bản demo giao diện — toàn bộ khách hàng và số liệu là <b>dữ liệu minh hoạ</b>, không phải hồ sơ kinh doanh thực tế. Thay đổi chỉ lưu trên trình duyệt này.</span>}
          {API_ON ? null : <DataTools ui={ui} getDb={() => dbRef.current} onRestoreText={(text) => { const next = parseBackupFile(text); backupNow('auto-restore'); replaceDb(next); }} onReset={() => { backupNow('auto-reset'); replaceDb(seedV2()); }} />}
        </div>
        {boot.report.error && ro ? <div role="alert" style={{ padding: '8px var(--page-gutter)', font: 'var(--type-caption)', color: 'var(--error-text)', background: 'var(--error-soft)', borderBottom: '1px solid var(--error-border)' }}><b>Chế độ chỉ đọc — không ghi dữ liệu.</b> {boot.report.error} Có thể dùng "Nhập sao lưu" hoặc "Khôi phục dữ liệu mẫu" (có sao lưu tự động) để tiếp tục.</div> : null}
        <div key={route.page + (route.id || '')} style={{ padding: 'var(--page-gutter)', maxWidth: 'var(--content-max)', margin: '0 auto', animation: 'sg-fade-up var(--dur-page) var(--ease-out)' }}>{body}</div>
      </main>
      {CUSTOMER_API ? null : <SearchResults q={q} db={db} onPick={(id) => { setQ(''); navigate('/customers/' + id); }} />}
      {chat && !API_ON ? (
        <div style={{ position: 'fixed', right: 16, top: 16, bottom: 16, width: 'min(420px, calc(100% - 32px))', zIndex: 66, animation: 'sg-toast-in var(--dur-slow) var(--ease-out)' }}>
          <ChatPanel height="100%" onClose={() => setChat(false)} agent={{ name: 'Trợ lý SISCOM', role: 'AI tổng hợp · bản demo', icon: 'sparkles' }}
            suggestions={['Khách hàng nào cần chăm sóc tuần này?', 'Tóm tắt công nợ quá hạn']}
            messages={[{ from: 'agent', text: 'Đây là trợ lý mô phỏng trong bản demo — câu trả lời được soạn sẵn từ dữ liệu minh hoạ, chưa kết nối mô hình AI thực.', time: '08:30' }]}
            onSend={(t) => new Promise((r) => setTimeout(() => r(/công nợ|nợ/i.test(t)
              ? { text: 'Theo dữ liệu minh hoạ: 6 hoá đơn quá hạn, tổng 2,1 tỷ. Lớn nhất là Sông Xanh Land (820 triệu, quá hạn 25 ngày).', sources: 'Nguồn: dữ liệu demo' }
              : { text: 'Theo dữ liệu minh hoạ: nên ưu tiên Hoàng Gia Riverside (cơ hội 12,6 tỷ đang đàm phán) và BV An Khang (báo giá chờ duyệt).', sources: 'Nguồn: dữ liệu demo' }), 1000))} />
        </div>
      ) : null}
      <Modal open={!!dlg} onClose={() => setDlg(null)} size="sm" icon={dlg && dlg.icon} tone={dlg && dlg.tone} title={dlg ? dlg.title : ''} description={dlg && dlg.description}
        footer={dlg ? <><Button variant="secondary" onClick={() => setDlg(null)}>{dlg.cancelLabel || 'Huỷ'}</Button><Button variant={dlg.tone === 'error' ? 'danger' : 'primary'} onClick={() => { const f = dlg.onConfirm; setDlg(null); f && f(); }}>{dlg.confirmLabel || 'Xác nhận'}</Button></> : null} />
      <div className="sg-toast-stack">{toasts.map((t) => <Toast key={t.id} {...t} onClose={() => setToasts((l) => l.filter((x) => x.id !== t.id))} />)}</div>
    </div>
  );
}
export default SiscomCrmApp;
