// Quyết định THUẦN của AuthGate (PR 8): phiên đã xác thực nhưng máy chủ báo mustChangePassword => ép đổi mật khẩu trước khi vào App
// (không có đường bỏ qua ngoài đổi thành công hoặc đăng xuất). Kiểm bằng node --test; AuthGate.jsx chỉ render theo kết quả này.
//   'forced'    : AUTHENTICATED và me.mustChangePassword === true
//   'app'       : AUTHENTICATED (me thiếu => không ép; /auth/me lần sau quyết định)
//   'restoring' : LOADING trong lúc khôi phục phiên khi tải trang
//   'login'     : mọi trường hợp còn lại (IDLE / ERROR / UNAVAILABLE / LOADING khi đăng nhập)
export function gateDecision(state, restoring) {
  if (!state) return 'login';
  if (state.status === 'AUTHENTICATED') return state.me && state.me.mustChangePassword === true ? 'forced' : 'app';
  if (state.status === 'LOADING' && restoring) return 'restoring';
  return 'login';
}
