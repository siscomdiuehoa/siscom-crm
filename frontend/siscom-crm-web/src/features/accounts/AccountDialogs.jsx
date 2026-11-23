import React from 'react';
import { Button, Input, Modal, Select } from '../../ds/index.js';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { GRANTABLE_ROLES, VERSION_CONFLICT, accountErrorMessage, roleLabel, validateAccountForm } from './accountsModel.js';

// P1: MỘT hộp thoại cho sáu thao tác của trang Tài khoản. kind: create | edit | role | resetPassword | disable | enable.
// Mật khẩu tạm chỉ nằm trong state của hộp thoại này: xoá ngay khi thao tác xong hoặc hộp đóng (component bị gỡ), không đưa vào thông báo,
// không lưu ở controller. Lỗi của máy chủ hiện ngay trong hộp, nội dung đang gõ được giữ.
const HAND_OVER = (name) => 'Hãy đưa mật khẩu tạm trực tiếp cho ' + name + '. Họ sẽ phải đổi khi đăng nhập lần đầu.';
const TITLE = {
  create: () => 'Thêm nhân viên', edit: (r) => 'Sửa thông tin — ' + r.code, role: (r) => 'Đổi vai trò — ' + r.fullName,
  resetPassword: (r) => 'Cấp lại mật khẩu — ' + r.fullName, disable: (r) => 'Khoá tài khoản — ' + r.fullName, enable: (r) => 'Mở lại tài khoản — ' + r.fullName,
};
const OK_LABEL = { create: 'Tạo tài khoản', edit: 'Lưu', role: 'Đổi vai trò', resetPassword: 'Cấp lại mật khẩu', disable: 'Khoá tài khoản', enable: 'Mở lại' };
const ICON = { create: 'user-plus', edit: 'pencil', role: 'shield', resetPassword: 'key-round', disable: 'lock', enable: 'lock-open' };
const box = (tone) => ({ padding: '10px 12px', borderRadius: 10, font: 'var(--type-sm)', color: 'var(--' + tone + '-text)', background: 'var(--' + tone + '-soft)', border: '1px solid var(--' + tone + '-border)' });
// Bốn ô hồ sơ của hộp Sửa: giá trị trong form <- dòng máy chủ trả.
const PROFILE_FIELDS = [['fullName', 'Họ tên'], ['email', 'Email đăng nhập'], ['departmentId', 'Phòng ban'], ['positionTitle', 'Chức danh']];
const formOf = (r) => ({ fullName: r ? r.fullName || '' : '', email: r ? r.email || '' : '', departmentId: r ? r.departmentId || '' : '', positionTitle: r ? r.positionTitle || '' : '' });
const row2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 };

function PasswordField({ value, onChange }) {
  return <Input label="Mật khẩu tạm" required type="password" autoComplete="new-password" maxLength={128} value={value} onChange={onChange} placeholder="Ít nhất 12 ký tự" hint="Bạn đưa trực tiếp cho nhân viên. Lần đăng nhập đầu họ buộc phải đổi." />;
}

export function AccountDialog({ ui, kind, row, onClose }) {
  const accounts = ui.customerApi.accounts;
  const s = useCustomerApiState(accounts);
  const busy = !!s.busy;
  const meta = s.meta;
  const [f, setF] = React.useState(() => ({
    ...formOf(row),
    role: kind === 'create' ? 'sales' : row && row.roles.length === 1 ? row.roles[0] : '', tempPassword: '', reason: '',
  }));
  const [base, setBase] = React.useState(row ? row.updatedAt : null); // mốc updatedAt của bản đang sửa (khoá lạc quan)
  const [seen, setSeen] = React.useState(() => formOf(row)); // bản máy chủ mà form đang dựa vào (để biết ô nào mình đã đụng)
  const [error, setError] = React.useState(null);
  const [conflict, setConflict] = React.useState(false);
  const [note, setNote] = React.useState(null);
  const set = (k) => (v) => { setError(null); setNote(null); setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v })); };
  const close = () => { setF((x) => ({ ...x, tempPassword: '' })); onClose(); };
  const current = row && row.roles.length === 1 ? row.roles[0] : null;

  const submit = async () => {
    if (busy) return;
    const problems = validateAccountForm(kind, kind === 'role' ? { role: f.role, current } : f);
    if (problems.length) { setError(problems.join(' ')); return; }
    const r = await accounts.act(kind, row, kind === 'edit' ? { ...f, updatedAt: base } : f);
    if (r.duplicate) return;
    if (!r.ok) { setConflict(r.error.code === VERSION_CONFLICT); setNote(null); setError(accountErrorMessage(r.error)); return; }
    const name = kind === 'create' ? f.fullName.trim() : row.fullName;
    const done = {
      create: { title: 'Đã tạo tài khoản', message: HAND_OVER(name) },
      edit: { title: 'Đã lưu', message: 'Đã lưu thông tin ' + (row ? row.code : '') + '.' },
      role: { title: 'Đã đổi vai trò', message: 'Đã đổi vai trò của ' + name + ' thành ' + roleLabel(f.role) + '.' },
      resetPassword: { title: 'Đã cấp lại mật khẩu', message: HAND_OVER(name) },
      disable: { title: 'Đã khoá', message: 'Đã khoá tài khoản ' + name + '.' },
      enable: { title: 'Đã mở lại tài khoản', message: HAND_OVER(name) },
    }[kind];
    ui.toast({ tone: 'success', ...done });
    close();
  };
  // Sau 409: lấy bản mới nhất. Ô mình CHƯA đụng => nhận giá trị mới của máy chủ (nếu không, lần lưu kế tiếp sẽ ghi đè ngược sửa đổi của người kia).
  // Ô mình ĐÃ sửa => giữ nội dung của mình; nếu người kia cũng vừa đổi chính ô đó thì nói rõ họ đổi thành gì để mình quyết.
  const refresh = async () => {
    const r = await accounts.fresh(row.id);
    if (r.ok) {
      const fresh = formOf(r.row); const next = { ...f }; const clash = [];
      for (const [k, label] of PROFILE_FIELDS) {
        if (f[k] === seen[k]) next[k] = fresh[k];
        else if (fresh[k] !== seen[k] && fresh[k] !== f[k]) clash.push('Người khác vừa đổi ' + label + ' thành “' + (k === 'departmentId' ? ((meta.departments || []).find((d) => d.id === fresh[k]) || {}).name || r.row.departmentName || '(trống)' : fresh[k] || '(trống)') + '”');
      }
      setF(next); setSeen(fresh); setBase(r.row.updatedAt); setConflict(false); setError(null);
      setNote(clash.length ? clash.join('. ') + '. Ô đó đang giữ nội dung của bạn — bấm Lưu sẽ ghi đè.' : 'Đã lấy bản mới nhất; các ô bạn chưa sửa đã cập nhật theo máy chủ. Kiểm tra lại rồi bấm Lưu.');
    }
    else setError(r.gone ? 'Không còn thấy tài khoản này trong danh sách. Hãy đóng hộp thoại và tải lại trang.' : accountErrorMessage(r.error));
  };

  const depts = [{ value: '', label: '— Chưa xếp phòng ban —' }].concat((meta.departments || []).map((d) => ({ value: d.id, label: d.name })));
  if (row && row.departmentId && !depts.some((d) => d.value === row.departmentId)) depts.push({ value: row.departmentId, label: (row.departmentName || 'Phòng ban cũ') + ' (không còn trong danh sách)' });
  const roles = GRANTABLE_ROLES.map((c) => ({ value: c, label: roleLabel(c) }));
  const profile = (
    <>
      <div style={row2}>
        <Input label="Họ tên" required maxLength={200} value={f.fullName} onChange={set('fullName')} placeholder="Nguyễn Văn A" />
        <Input label="Email đăng nhập" required type="email" autoComplete="off" maxLength={254} value={f.email} onChange={set('email')} placeholder="ten@congty.vn" />
      </div>
      <div style={row2}>
        <Select label="Phòng ban" value={f.departmentId} onChange={set('departmentId')} options={depts} disabled={meta.status !== 'ready'} hint={meta.status === 'error' ? 'Chưa tải được danh sách phòng ban.' : meta.status !== 'ready' ? 'Đang tải…' : undefined} />
        <Input label="Chức danh" maxLength={120} value={f.positionTitle} onChange={set('positionTitle')} placeholder="Không bắt buộc" />
      </div>
    </>
  );
  return (
    <Modal open onClose={busy ? undefined : close} size="md" icon={ICON[kind]} tone={kind === 'disable' ? 'error' : 'blue'} title={TITLE[kind](row)}
      footer={<><Button variant="secondary" disabled={busy} onClick={close}>Huỷ</Button><Button variant={kind === 'disable' ? 'danger' : 'primary'} loading={busy} onClick={submit}>{OK_LABEL[kind]}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {kind === 'create' ? (
          <>
            {profile}
            <Select label="Vai trò" required value={f.role} onChange={set('role')} options={roles} hint="Vai trò quyết định người này thấy và làm được gì trong CRM." />
            <PasswordField value={f.tempPassword} onChange={set('tempPassword')} />
          </>
        ) : null}
        {kind === 'edit' ? <>{profile}<p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Mã nhân viên, lịch sử và khách hàng đang phụ trách giữ nguyên. Đổi email thì lần sau người này đăng nhập bằng email mới.</p></> : null}
        {kind === 'role' ? (
          <>
            <Select label="Vai trò mới" required value={f.role} onChange={set('role')} options={roles} hint={'Hiện tại: ' + (current ? roleLabel(current) : '—')} />
            <div role="note" style={box('warning')}>Quyền mới có hiệu lực ngay. Vai trò Quản trị CRM được quản lý tài khoản và xem toàn bộ dữ liệu.</div>
          </>
        ) : null}
        {kind === 'resetPassword' ? <><PasswordField value={f.tempPassword} onChange={set('tempPassword')} /><div role="note" style={box('warning')}>Người này sẽ bị đăng xuất khỏi mọi thiết bị ngay.</div></> : null}
        {kind === 'disable' ? (
          <>
            <Input label="Lý do" required maxLength={200} value={f.reason} onChange={set('reason')} placeholder="Ví dụ: nghỉ việc từ 01/12" />
            <div role="note" style={box('error')}>Người này bị đăng xuất ngay và không đăng nhập được nữa. Khách hàng, cơ hội và lịch sử của họ giữ nguyên. Có thể mở lại sau.</div>
          </>
        ) : null}
        {kind === 'enable' ? <PasswordField value={f.tempPassword} onChange={set('tempPassword')} /> : null}
        {note ? <div role="status" style={box('warning')}>{note}</div> : null}
        {error ? (
          <div role="alert" style={{ ...box('error'), display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 200px', minWidth: 0 }}>{error}</span>
            {conflict && kind === 'edit' ? <Button size="sm" variant="secondary" disabled={busy} onClick={refresh}>Tải lại</Button> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
