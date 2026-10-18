import React from 'react';
import { Card, KpiCard, BarChart, TrendChart, Badge, Button, Tabs, Select, Avatar, Icon, IconButton, AgentStatus } from '../ds/index.js';
import * as U from '../data/util.js';
import { APP_DATA } from '../data/demoData.js';

const RANGES = {
  month: { label: 'Tháng 10/2026', idx: [11], prev: [10], cmp: 'so với tháng 9' },
  q3: { label: 'Quý 3/2026', idx: [8, 9, 10], prev: [5, 6, 7], cmp: 'so với quý 2' },
  h6: { label: '6 tháng gần nhất', idx: [6, 7, 8, 9, 10, 11], prev: [0, 1, 2, 3, 4, 5], cmp: 'so với 6 tháng trước' },
  ytd: { label: 'Từ đầu năm 2026', idx: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], prev: null, cmp: 'so với kế hoạch' },
};
const DEPTS = ['all', 'HVAC', 'Điện – ELV', 'PCCC', 'Bảo trì'];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const tyFmt = (v) => U.ty(v) + ' tỷ';

function useSeries(dept) {
  const D = APP_DATA;
  const keys = dept === 'all' ? Object.keys(D.depts) : [dept];
  const allTotal = sum(Object.values(D.depts).map((d) => sum(d.rev)));
  const share = sum(keys.map((k) => sum(D.depts[k].rev))) / allTotal;
  const rev = (i) => sum(keys.map((k) => D.depts[k].rev[i])) * 1e9;
  const profit = (i) => sum(keys.map((k, j) => D.depts[k].rev[i] * D.depts[k].margin * (1 + 0.05 * Math.sin(i * 1.7 + j)))) * 1e9;
  const plan = (i) => D.planTotal[i] * share * 1e9;
  const recv = sum(keys.map((k) => D.depts[k].recv)) * 1e9, recvOver = sum(keys.map((k) => D.depts[k].overdueRecv)) * 1e9;
  return { rev, profit, plan, recv, recvOver, share };
}

function SectionTitle({ children, right }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px 12px' }}><h3 style={{ margin: 0, font: 'var(--type-h4)', letterSpacing: 'var(--tracking-snug)', flex: 1 }}>{children}</h3>{right}</div>;
}

function Insights({ s, r, approvals, ui }) {
  const perf = sum(r.idx.map(s.rev)) / sum(r.idx.map(s.plan)) * 100;
  const items = [
    { icon: perf >= 100 ? 'trending-up' : 'trending-down', tone: perf >= 100 ? 'var(--success)' : 'var(--warning)', text: <>Doanh thu {r.label.toLowerCase()} đạt <b>{perf.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% kế hoạch</b>{perf >= 100 ? ' — HVAC là động lực chính.' : ' — cần đẩy nhanh các cơ hội đang đàm phán.'}</> },
    { icon: 'receipt', tone: 'var(--warning)', text: <>Công nợ quá hạn <b>{U.ty(s.recvOver)} tỷ</b>; Sông Xanh Land chiếm tỷ trọng lớn nhất (820 triệu, 25 ngày).</> },
    { icon: 'file-clock', tone: 'var(--accent)', text: <><b>{approvals.length} báo giá</b> đang chờ phê duyệt, tổng {U.ty(sum(approvals.map((a) => a.value)))} tỷ — nên xử lý trước thứ Sáu.</> },
  ];
  return (
    <section className="sg-card sg-glass-ai" style={{ padding: 20, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220 }}>
        <span className="sg-agent__tile"><Icon name="sparkles" size={22} /></span>
        <div><div style={{ font: 'var(--type-h4)' }}>Nhận định AI cho Ban điều hành</div><div style={{ display: 'flex', gap: 6, alignItems: 'center', font: 'var(--type-caption)', color: 'var(--text-3)', marginTop: 2 }}>Agent Điều hành · <Badge size="sm" tone="outline">Mô phỏng</Badge></div></div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, minWidth: 0 }}>
        {items.map((it, i) => <div key={i} style={{ display: 'flex', gap: 10, font: 'var(--type-sm)', color: 'var(--text-2)' }}><Icon name={it.icon} size={16} color={it.tone} style={{ marginTop: 2 }} /><span style={{ textWrap: 'pretty' }}>{it.text}</span></div>)}
      </div>
      <Button variant="secondary" size="sm" icon="message-square" onClick={ui.openChat}>Hỏi Trợ lý AI</Button>
    </section>
  );
}

function Pipeline({ share, ui }) {
  const st = APP_DATA.stages.map(([n, c, v]) => [n, Math.max(1, Math.round(c * share)), v * share * 1e9]);
  const max = Math.max(...st.map((x) => x[2]));
  const open = sum(st.slice(0, 4).map((x) => x[2]));
  return (
    <Card title="Tổng quan pipeline" subtitle={'Đang mở ' + U.ty(open) + ' tỷ VNĐ'} actions={<Button variant="ghost" size="sm" iconRight="arrow-up-right" onClick={() => ui.navigate('/pipeline')}>Chi tiết</Button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {st.map(([n, c, v], i) => (
          <div key={n} style={{ display: 'grid', gridTemplateColumns: 'minmax(84px,auto) 1fr auto', gap: 10, alignItems: 'center' }}>
            <span style={{ font: 'var(--type-sm)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{n}</span>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-sunken)', overflow: 'hidden' }}><div style={{ width: (v / max) * 100 + '%', height: '100%', borderRadius: 5, background: i === 4 ? 'var(--success)' : 'var(--chart-' + (i % 2 ? 2 : 1) + ')', transition: 'width var(--dur-slow) var(--ease-out)' }} /></div>
            <span className="sg-num" style={{ font: 'var(--type-sm)', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 96 }}><b style={{ fontWeight: 600 }}>{U.ty(v)} tỷ</b> <span style={{ color: 'var(--text-3)' }}>· {c}</span></span>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
          <div className="sg-agent__stat"><b>38,5%</b><span>Tỷ lệ chốt 90 ngày</span></div>
          <div className="sg-agent__stat"><b>{U.ty(open / Math.max(1, sum(st.slice(0, 4).map((x) => x[1]))), 2)} tỷ</b><span>Giá trị TB / cơ hội</span></div>
        </div>
      </div>
    </Card>
  );
}

function Opportunities({ dept, ui }) {
  const D = ui.db;
  const byId = Object.fromEntries(ui.db.customers.map((c) => [c.id, c]));
  const rows = D.opportunities.filter((o) => dept === 'all' || o.dept === dept).sort((a, b) => b.value - a.value).slice(0, 6);
  const stTone = { 'Tiếp cận': 'neutral', 'Khảo sát': 'blue', 'Báo giá': 'cyan', 'Đàm phán': 'warning' };
  return (
    <section className="sg-card sg-solid" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <SectionTitle right={<Button variant="ghost" size="sm" onClick={() => ui.navigate('/pipeline')}>Xem tất cả</Button>}>Cơ hội kinh doanh lớn</SectionTitle>
      <div className="sg-table-scroll sg-scroll">
        <table className="sg-table sg-table--compact">
          <thead><tr><th>Cơ hội</th><th>Giai đoạn</th><th className="sg-num">Giá trị</th><th>Xác suất</th><th>Dự kiến chốt</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((o) => (
              <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => byId[o.customerId] && ui.navigate('/customers/' + o.customerId)}>
                <td style={{ padding: '8px 16px' }}><div style={{ fontWeight: 500 }}>{o.name}</div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{byId[o.customerId] ? byId[o.customerId].short : o.customerId} · {o.owner}</div></td>
                <td><Badge tone={stTone[o.stage]}>{o.stage}</Badge></td>
                <td className="sg-num" style={{ fontWeight: 500 }}>{U.ty(o.value, 2)} tỷ</td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}><div className="sg-progress" style={{ flex: 1 }}><div className="sg-progress__bar" style={{ width: o.prob + '%' }} /></div><span className="sg-num" style={{ font: 'var(--type-caption)', width: 30 }}>{o.prob}%</span></div></td>
                <td>{U.dmy(o.close)}</td>
              </tr>
            )) : <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-3)' }}>Không có cơ hội cho bộ phận này.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentCustomers({ ui }) {
  const rows = [...ui.db.customers].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).slice(0, 5);
  return (
    <section className="sg-card sg-solid" style={{ overflow: 'hidden' }}>
      <SectionTitle right={<Button variant="ghost" size="sm" onClick={() => ui.navigate('/customers')}>Tất cả</Button>}>Khách hàng mới</SectionTitle>
      <div style={{ padding: '0 8px 8px' }}>
        {rows.map((c) => (
          <button key={c.id} type="button" className="sg-nav-item" style={{ height: 'auto', padding: '10px 12px', gap: 12 }} onClick={() => ui.navigate('/customers/' + c.id)}>
            <Avatar name={c.short} square size={34} />
            <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', color: 'var(--text-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.short}</span><span style={{ display: 'block', font: 'var(--type-caption)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.industry} · {U.dmy(c.createdAt)}</span></span>
            <Badge size="sm" tone={U.TIER_TONE[c.tier]}>{c.tier}</Badge>
          </button>
        ))}
      </div>
    </section>
  );
}

function Approvals({ list, ui }) {
  const byId = Object.fromEntries(ui.db.customers.map((c) => [c.id, c]));
  const act = (a, ok) => ui.confirm({
    title: (ok ? 'Phê duyệt ' : 'Từ chối ') + a.code + '?', icon: ok ? 'check' : 'x', tone: ok ? 'blue' : 'error', confirmLabel: ok ? 'Phê duyệt' : 'Từ chối',
    description: ok ? 'Báo giá ' + U.ty(a.value, 2) + ' tỷ sẽ được chuyển sang trạng thái "Đã duyệt" và sẵn sàng gửi khách hàng.' : 'Báo giá sẽ được trả về người lập để chỉnh sửa.',
    onConfirm: () => { const r = ui.api.decideApproval(a.code, ok); if (r.ok) ui.toast(ok ? { tone: 'success', title: 'Đã phê duyệt ' + a.code, message: 'Đã ghi vào dữ liệu trên trình duyệt này; chưa gửi tới hệ thống thực.' } : { tone: 'warning', title: 'Đã trả về ' + a.code }); },
  });
  return (
    <section className="sg-card sg-solid" style={{ overflow: 'hidden' }}>
      <SectionTitle right={<AgentStatus status="waiting" pill label={list.length + ' chờ duyệt'} />}>Báo giá chờ phê duyệt</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {list.length ? list.map((a) => (
          <div key={a.code} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{a.code}</span>{a.ai ? <Badge size="sm" tone="cyan" icon="sparkles">AI soạn</Badge> : null}</div>
              <div style={{ fontWeight: 500, marginTop: 2 }}>{byId[a.customerId] ? byId[a.customerId].short : ''} — {a.title}</div>
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{U.ty(a.value, 2)} tỷ · biên LN <span style={{ color: a.margin < 15 ? 'var(--warning-text)' : 'inherit', fontWeight: a.margin < 15 ? 600 : 400 }}>{a.margin.toLocaleString('vi-VN')}%</span> · {a.by} · {a.submitted}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}><Button size="sm" variant="secondary" disabled={!ui.can('approval.decide')} onClick={() => act(a, false)}>Từ chối</Button><Button size="sm" icon="check" disabled={!ui.can('approval.decide')} onClick={() => act(a, true)}>Phê duyệt</Button></div>
          </div>
        )) : <div style={{ padding: '24px 20px', textAlign: 'center', font: 'var(--type-sm)', color: 'var(--text-3)', borderTop: '1px solid var(--border-subtle)' }}><Icon name="circle-check" size={18} color="var(--success)" style={{ marginRight: 6, verticalAlign: -3 }} />Không còn báo giá chờ duyệt.</div>}
      </div>
    </section>
  );
}

function Alerts({ dept, ui }) {
  const D = ui.db;
  const [tab, setTab] = React.useState('debt');
  const byId = Object.fromEntries(ui.db.customers.map((c) => [c.id, c]));
  const debts = D.overdue.filter((o) => dept === 'all' || o.dept === dept);
  const alerts = D.contractAlerts.filter((o) => dept === 'all' || o.dept === dept);
  const tile = (tone, icon) => <span className="sg-kpi__icon" style={{ width: 32, height: 32, background: 'var(--' + (tone === 'blue' ? 'primary' : tone) + '-soft)', color: 'var(--' + (tone === 'blue' ? 'primary' : tone) + ')' }}><Icon name={icon} size={16} /></span>;
  return (
    <section className="sg-card sg-solid" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '8px 20px 0' }}><Tabs variant="line" value={tab} onChange={setTab} items={[{ id: 'debt', label: 'Công nợ quá hạn', count: debts.length }, { id: 'ct', label: 'Cảnh báo hợp đồng', count: alerts.length }]} /></div>
      <div>
        {(tab === 'debt' ? debts : alerts).length === 0 ? <div style={{ padding: 24, textAlign: 'center', font: 'var(--type-sm)', color: 'var(--text-3)' }}>Không có cảnh báo cho bộ phận này.</div> : null}
        {tab === 'debt' ? debts.map((o) => (
          <div key={o.invoice} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            {tile(o.days > 30 ? 'error' : 'warning', 'receipt')}
            <div style={{ flex: '1 1 160px', minWidth: 0 }}><button type="button" onClick={() => ui.navigate('/customers/' + o.customerId)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 500, color: 'var(--text-1)' }}>{byId[o.customerId] ? byId[o.customerId].short : o.customerId}</button><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{o.invoice} · hạn {o.due}</div></div>
            <div style={{ textAlign: 'right' }}><div className="sg-num" style={{ fontWeight: 600 }}>{U.money(o.amount)}</div><Badge size="sm" tone={o.days > 30 ? 'error' : 'warning'}>Quá hạn {o.days} ngày</Badge></div>
            <IconButton icon="send" label="Gửi nhắc nợ" size="sm" variant="secondary" tooltip onClick={() => ui.toast({ tone: 'success', title: 'Đã tạo email nhắc nợ', message: 'Mô phỏng — chưa gửi email thực.' })} />
          </div>
        )) : alerts.map((a) => (
          <div key={a.code} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            {tile(a.tone, a.icon)}
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontWeight: 500 }}>{a.type}</span><span style={{ font: 'var(--type-mono)', fontSize: 12, color: 'var(--text-3)' }}>{a.code}</span></div><div style={{ font: 'var(--type-caption)', color: 'var(--text-2)' }}>{byId[a.customerId] ? byId[a.customerId].short : ''} — {a.detail}</div></div>
            <Button size="sm" variant="ghost" iconRight="chevron-right" onClick={() => ui.navigate('/customers/' + a.customerId)}>Xem</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardPage({ ui }) {
  const D = APP_DATA;
  const [range, setRange] = React.useState('month');
  const [dept, setDept] = React.useState('all');
  const [chartMode, setChartMode] = React.useState('month');
  const approvals = ui.db.approvals.filter((a) => a.status === 'Chờ duyệt');
  const r = RANGES[range], s = useSeries(dept);
  const R = sum(r.idx.map(s.rev)), P = sum(r.idx.map(s.profit)), PL = sum(r.idx.map(s.plan));
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const dRev = r.prev ? pct(R, sum(r.prev.map(s.rev))) : pct(R, PL);
  const dProf = r.prev ? pct(P, sum(r.prev.map(s.profit))) : pct(P, PL * 0.19);
  const perf = (R / PL) * 100;
  const dPerf = r.prev ? perf - (sum(r.prev.map(s.rev)) / sum(r.prev.map(s.plan))) * 100 : perf - 100;
  const cIdx = r.idx.length >= 3 ? r.idx : [6, 7, 8, 9, 10, 11];
  const ytd = RANGES.ytd.idx;
  const cum = (f) => { let a = 0; return ytd.map((i) => (a += f(i))); };
  const apList = approvals.filter((a) => dept === 'all' || a.dept === dept);
  const spark = (f) => [5, 6, 7, 8, 9, 10, 11].map((i) => f(i) / 1e9);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 200 }}><Select label="Kỳ báo cáo" icon="calendar" value={range} onChange={setRange} options={Object.entries(RANGES).map(([v, o]) => ({ value: v, label: o.label }))} /></div>
        {ui.mobile ? <div style={{ width: 200 }}><Select label="Bộ phận" icon="building-2" value={dept} onChange={setDept} options={DEPTS.map((d) => ({ value: d, label: d === 'all' ? 'Tất cả bộ phận' : d }))} /></div>
          : <div className="sg-field"><span className="sg-label">Bộ phận</span><Tabs value={dept} onChange={setDept} items={DEPTS.map((d) => ({ id: d, label: d === 'all' ? 'Tất cả' : d }))} /></div>}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" icon="download" onClick={() => ui.toast({ tone: 'info', title: 'Xuất báo cáo PDF cần backend', message: 'Tính năng sẽ hoạt động khi kết nối máy chủ báo cáo.' })}>Xuất báo cáo</Button>
      </div>
      <Insights s={s} r={r} approvals={apList} ui={ui} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 16 }}>
        <KpiCard label="Doanh thu" value={U.ty(R)} unit="tỷ VNĐ" delta={+dRev.toFixed(1)} deltaLabel={r.cmp} icon="wallet" spark={spark(s.rev)} />
        <KpiCard label={'Lợi nhuận gộp · biên ' + ((P / R) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%'} value={U.ty(P, 2)} unit="tỷ VNĐ" delta={+dProf.toFixed(1)} deltaLabel={r.cmp} icon="chart-no-axes-combined" tone="cyan" spark={spark(s.profit)} />
        <KpiCard label="Công nợ phải thu" value={U.ty(s.recv)} unit="tỷ VNĐ" delta={-4.2} invertDelta deltaLabel={'quá hạn ' + U.ty(s.recvOver) + ' tỷ'} icon="receipt" tone="warning" />
        <KpiCard label="Hiệu suất kinh doanh" value={perf.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} unit="% kế hoạch" delta={+dPerf.toFixed(1)} deltaLabel={r.prev ? 'điểm % ' + r.cmp : 'điểm % so với 100%'} icon="target" tone={perf >= 100 ? 'success' : 'warning'} />
      </div>
      <div className="dash-2-1">
        <Card title="Doanh thu & lợi nhuận gộp" subtitle={(chartMode === 'month' ? 'Theo tháng' : 'Luỹ kế 2026 so với kế hoạch') + ' · VNĐ'} actions={<Tabs value={chartMode} onChange={setChartMode} items={[{ id: 'month', label: 'Theo tháng' }, { id: 'cum', label: 'Luỹ kế' }]} />}>
          {chartMode === 'month'
            ? <BarChart height={260} format={tyFmt} labels={cIdx.map((i) => D.months[i])} series={[{ name: 'Doanh thu', data: cIdx.map(s.rev) }, { name: 'Lợi nhuận gộp', data: cIdx.map(s.profit) }]} />
            : <TrendChart height={260} format={tyFmt} labels={ytd.map((i) => D.months[i])} series={[{ name: 'Doanh thu luỹ kế', data: cum(s.rev) }, { name: 'Lợi nhuận luỹ kế', data: cum(s.profit) }, { name: 'Kế hoạch doanh thu', data: cum(s.plan), dashed: true, color: 'var(--slate-400)' }]} />}
        </Card>
        <Pipeline share={s.share} ui={ui} />
      </div>
      <div className="dash-2-1"><Opportunities dept={dept} ui={ui} /><RecentCustomers ui={ui} /></div>
      <div className="dash-1-1"><Approvals list={apList} ui={ui} /><Alerts dept={dept} ui={ui} /></div>
    </div>
  );
}
export default DashboardPage;
