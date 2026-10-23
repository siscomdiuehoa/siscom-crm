import React from 'react';
import { EmptyState, Button } from '../../ds/index.js';

// Shown instead of any module that still reads the localStorage/demo dataset while the customer API flag is ON.
// It renders NO demo figures and calls NO API: the module has no server contract yet.
export const API_UNSUPPORTED_NOTE = 'chưa hỗ trợ trong chế độ API';

export default function ApiModeUnsupported({ title, onBack }) {
  return (
    <div className="sg-card sg-glass" style={{ marginTop: 24 }} role="note">
      <EmptyState icon="server-off" title={title + ' — ' + API_UNSUPPORTED_NOTE}
        description="Mô-đun này hiện chỉ có số liệu minh hoạ nên bị ẩn khi bật chế độ API, để không hiển thị dữ liệu giả như dữ liệu thật. Chỉ danh sách và chi tiết khách hàng lấy từ máy chủ được hỗ trợ."
        action={<Button onClick={onBack}>Về Quản lý khách hàng</Button>} />
    </div>
  );
}
