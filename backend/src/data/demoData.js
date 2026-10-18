/* SISCOM CRM — DỮ LIỆU MINH HOẠ. Tên công ty, MST, số điện thoại, email và số liệu đều là giả lập (tên miền "-demo.vn"), không phải hồ sơ kinh doanh thực tế. */
export const APP_DATA = (() => {
  const OWNERS = ['Trần Minh Khoa', 'Lê Thu Hà', 'Nguyễn Đức Anh', 'Võ Thị Mai', 'Phạm Gia Bảo'];
  // [id, name, short, industry, tier, status, ownerIdx, address, city, revenue(tỷ), source, created, slug]
  const RAW = [
    ['KH-00128', 'Công ty CP Tập đoàn Xây dựng Hưng Phát', 'Hưng Phát', 'Tổng thầu xây dựng', 'Chiến lược', 'Đang giao dịch', 0, '235 Võ Văn Kiệt, P. Cầu Ông Lãnh', 'TP. Hồ Chí Minh', 24.6, 'Giới thiệu', '2023-03-14', 'hungphat'],
    ['KH-00342', 'Bệnh viện Đa khoa Quốc tế An Khang', 'BV An Khang', 'Y tế', 'Tiềm năng', 'Tiềm năng', 1, '108 Hoàng Quốc Việt, P. Nghĩa Đô', 'Hà Nội', 0, 'Hội chợ triển lãm', '2026-09-22', 'ankhang'],
    ['KH-00087', 'Công ty CP Phát triển Đô thị Sông Xanh', 'Sông Xanh Land', 'Bất động sản', 'VIP', 'Đang giao dịch', 0, '12 Mai Chí Thọ, P. An Khánh', 'TP. Thủ Đức', 31.2, 'Đấu thầu', '2022-08-02', 'songxanh'],
    ['KH-00211', 'Công ty TNHH Khu công nghiệp Tân Đông', 'KCN Tân Đông', 'Nhà máy – KCN', 'Chiến lược', 'Đang giao dịch', 2, 'Đường số 8, KCN Tân Đông, P. Thuận Giao', 'Bình Dương', 18.4, 'Đấu thầu', '2022-11-19', 'tandong'],
    ['KH-00405', 'Công ty CP Khách sạn Sơn Trà Riverside', 'Sơn Trà Riverside', 'Khách sạn – Resort', 'Thường', 'Đang giao dịch', 3, '45 Trần Hưng Đạo, P. An Hải Tây', 'Đà Nẵng', 2.95, 'Website', '2024-05-06', 'sontra'],
    ['KH-00156', 'Công ty CP Hoá chất Phước Long', 'Hoá chất Phước Long', 'Nhà máy – KCN', 'VIP', 'Đang giao dịch', 2, 'KCN Phú Mỹ 1, P. Phú Mỹ', 'Bà Rịa – Vũng Tàu', 15.7, 'Giới thiệu', '2023-01-10', 'phuoclong'],
    ['KH-00478', 'Công ty CP Dữ liệu Số Bắc Hà', 'Bắc Hà Data', 'Trung tâm dữ liệu', 'Tiềm năng', 'Tiềm năng', 1, 'Khu CNC Hòa Lạc, Thạch Thất', 'Hà Nội', 0, 'Website', '2026-08-28', 'bachadata'],
    ['KH-00063', 'Công ty TNHH Bao bì Long Thành', 'Bao bì Long Thành', 'Nhà máy – KCN', 'Thường', 'Ngừng giao dịch', 0, 'KCN Long Thành, X. Tam An', 'Đồng Nai', 4.1, 'Giới thiệu', '2021-06-21', 'baobilt'],
    ['KH-00390', 'Trường Quốc tế Ánh Dương', 'Trường Ánh Dương', 'Giáo dục', 'Thường', 'Đang giao dịch', 3, '78 Nguyễn Văn Hưởng, P. Thảo Điền', 'TP. Hồ Chí Minh', 1.8, 'Website', '2024-09-15', 'anhduong'],
    ['KH-00512', 'Công ty CP Bất động sản Hoàng Gia Riverside', 'Hoàng Gia Riverside', 'Bất động sản', 'VIP', 'Tiềm năng', 4, '2 Lương Định Của, P. An Khánh', 'TP. Thủ Đức', 0, 'Đấu thầu', '2026-07-30', 'hoanggia'],
    ['KH-00530', 'Công ty TNHH Dược phẩm Minh Tâm', 'Dược Minh Tâm', 'Dược phẩm', 'Tiềm năng', 'Tiềm năng', 4, 'KCN Tân Đức, X. Hựu Thạnh, Đức Hòa', 'Long An', 0, 'Hội chợ triển lãm', '2026-10-03', 'minhtam'],
    ['KH-00298', 'Công ty CP Trung tâm Thương mại Vạn Phúc', 'Vạn Phúc Plaza', 'Thương mại – Bán lẻ', 'VIP', 'Đang giao dịch', 1, '15 Lạch Tray, P. Lạch Tray', 'Hải Phòng', 9.6, 'Giới thiệu', '2023-10-04', 'vanphuc'],
    ['KH-00177', 'Công ty CP Thực phẩm Đông Á', 'Thực phẩm Đông Á', 'Nhà máy – KCN', 'Chiến lược', 'Đang giao dịch', 2, 'KCN Phố Nối A, X. Lạc Hồng', 'Hưng Yên', 12.3, 'Đấu thầu', '2022-04-12', 'dongafood'],
    ['KH-00521', 'Bệnh viện Sản Nhi Hồng Đức', 'BV Hồng Đức', 'Y tế', 'Thường', 'Đang giao dịch', 3, '120 Đường 30/4, P. Xuân Khánh', 'Cần Thơ', 2.4, 'Website', '2026-09-30', 'hongduc'],
    ['KH-00455', 'Công ty TNHH Tòa nhà Lotus Tower', 'Lotus Tower', 'Bất động sản', 'Thường', 'Tạm ngưng', 4, '88 Láng Hạ, P. Láng Hạ', 'Hà Nội', 3.2, 'Giới thiệu', '2023-12-01', 'lotustower'],
    ['KH-00533', 'Công ty TNHH Điện tử Kim Sơn', 'Điện tử Kim Sơn', 'Điện tử', 'Tiềm năng', 'Tiềm năng', 0, 'KCN Quế Võ, P. Phương Liễu', 'Bắc Ninh', 0, 'Website', '2026-10-08', 'kimson'],
  ];
  const PHONE_AREA = { 'TP. Hồ Chí Minh': '028', 'TP. Thủ Đức': '028', 'Hà Nội': '024', 'Bình Dương': '0274', 'Đà Nẵng': '0236', 'Bà Rịa – Vũng Tàu': '0254', 'Đồng Nai': '0251', 'Long An': '0272', 'Hải Phòng': '0225', 'Hưng Yên': '0221', 'Cần Thơ': '0292', 'Bắc Ninh': '0222' };
  const TAGS = { 'Y tế': ['Phòng sạch', 'AHU'], 'Bất động sản': ['HVAC', 'PCCC'], 'Nhà máy – KCN': ['Chiller', 'Thông gió'], 'Trung tâm dữ liệu': ['CRAC', 'Chiller'], 'Tổng thầu xây dựng': ['HVAC', 'ELV'], 'Khách sạn – Resort': ['VRV'], 'Giáo dục': ['VRV', 'Bảo trì'], 'Dược phẩm': ['GMP', 'AHU'], 'Thương mại – Bán lẻ': ['Chiller', 'BMS'], 'Điện tử': ['Phòng sạch', 'Điện động lực'] };
  const customers = RAW.map((r, i) => ({
    id: r[0], name: r[1], short: r[2], industry: r[3], tier: r[4], status: r[5], owner: OWNERS[r[6]],
    address: r[7], city: r[8], revenue: r[9] * 1e9, source: r[10], createdAt: r[11],
    taxId: String(3100000000 + ((i * 7919393) % 899999999)).slice(0, 10),
    phone: (PHONE_AREA[r[8]] || '028') + ' ' + String(3700 + i * 137).slice(0, 4) + ' ' + String(1000 + i * 611).slice(-4),
    email: 'lienhe@' + r[12] + '-demo.vn', website: r[12] + '-demo.vn', tags: TAGS[r[3]] || [], note: '',
  }));

  const FIRST = ['Nguyễn Thị Lan', 'Đỗ Văn Quang', 'Phan Hoàng Nam', 'Lâm Quốc Trung', 'Trương Mỹ Linh', 'Huỳnh Tấn Phát', 'Bùi Thanh Sơn', 'Lê Văn Tài', 'Đặng Thu Trang', 'Ngô Gia Huy', 'Mai Phương Thảo', 'Tạ Đình Long', 'Vũ Hải Yến', 'Hồ Minh Châu', 'Kiều Anh Tuấn', 'Dương Ngọc Hân'];
  const TITLES = ['Trưởng phòng Mua hàng', 'Phó Giám đốc Kỹ thuật', 'Giám đốc Dự án', 'Trưởng ban Cơ điện', 'Kế toán trưởng', 'Kỹ sư trưởng'];
  const contacts = [];
  customers.forEach((c, i) => {
    const n = 1 + (i % 3);
    for (let k = 0; k < n; k++) {
      const name = FIRST[(i * 3 + k) % FIRST.length];
      const last = name.split(' ').pop().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
      contacts.push({ id: 'LH-' + (1000 + contacts.length), customerId: c.id, name, title: TITLES[(i + k * 2) % TITLES.length], phone: '09' + String(10000000 + ((i * 31 + k * 7) * 1234567) % 89999999).padStart(8, '0').replace(/(\d{2})(\d{3})(\d{3})/, '$1 $2 $3'), email: last + (k ? k : '') + '@' + c.website, primary: k === 0 });
    }
  });

  const ITYPES = [['Cuộc gọi', 'phone', 'blue'], ['Email', 'mail', 'neutral'], ['Gặp mặt', 'users', 'success'], ['Khảo sát hiện trường', 'hard-hat', 'warning']];
  const ITEXT = ['Trao đổi nhu cầu cải tạo hệ thống điều hoà trung tâm', 'Gửi hồ sơ năng lực và danh mục dự án tham chiếu', 'Họp kỹ thuật làm rõ khối lượng ống gió và thiết bị', 'Khảo sát mặt bằng phòng máy, đo đạc tuyến ống', 'Nhắc lịch bảo trì định kỳ quý 4', 'Thương thảo điều khoản thanh toán và tiến độ'];
  const interactions = [];
  customers.forEach((c, i) => {
    const n = 2 + (i % 3);
    for (let k = 0; k < n; k++) {
      const t = ITYPES[(i + k) % 4];
      const day = Math.max(1, 9 - k * 3 - (i % 3));
      interactions.push({ id: 'TT-' + (5000 + interactions.length), customerId: c.id, type: t[0], content: ITEXT[(i * 2 + k) % ITEXT.length], date: '2026-' + (day > 0 && k < 2 ? '10' : '09') + '-' + String(k < 2 ? day : 28 - k * 4).padStart(2, '0'), by: c.owner, ai: false });
    }
  });

  const quotes = [
    ['BG-2026-121', 'KH-00342', 'Khối phòng mổ – hệ thống phòng sạch', 3.84, 'Chờ duyệt', '2026-10-08'], ['BG-2026-118', 'KH-00512', 'HVAC tổng thể tháp A', 12.6, 'Chờ duyệt', '2026-10-06'],
    ['BG-2026-116', 'KH-00156', 'Tủ điện MCC mở rộng', 3.05, 'Chờ duyệt', '2026-10-04'], ['BG-2026-119', 'KH-00478', 'Hệ thống CRAC phòng máy chủ', 7.2, 'Nháp', '2026-10-05'],
    ['BG-2026-117', 'KH-00211', 'Kho lạnh B – Chiller', 5.6, 'Thắng', '2026-09-29'], ['BG-2026-115', 'KH-00128', 'Văn phòng HP Tower – ELV', 2.1, 'Đã gửi', '2026-09-26'],
    ['BG-2026-112', 'KH-00390', 'Bảo trì VRV 3 năm', 0.92, 'Thắng', '2026-09-20'], ['BG-2026-108', 'KH-00405', 'Cải tạo VRV tầng 5–12', 1.75, 'Từ chối', '2026-09-12'],
    ['BG-2026-104', 'KH-00087', 'Block S3 – PCCC', 4.3, 'Hết hạn', '2026-09-02'], ['BG-2026-099', 'KH-00128', 'Nhà xưởng Hưng Phát 2 – Thông gió', 1.6, 'Thắng', '2026-08-18'],
    ['BG-2026-122', 'KH-00530', 'Xưởng GMP – AHU & phòng sạch', 4.9, 'Đã gửi', '2026-10-09'], ['BG-2026-110', 'KH-00298', 'Thay chiller tầng mái', 2.7, 'Đã gửi', '2026-09-16'],
  ].map((q) => ({ code: q[0], customerId: q[1], title: q[2], value: q[3] * 1e9, status: q[4], date: q[5] }));
  const contracts = [
    ['HĐ-2026-031', 'KH-00128', 'HVAC & ELV – HP Tower', 12.48, 'Đang thực hiện', '2026-10-02', '2027-06-30', 30], ['HĐ-2026-027', 'KH-00087', 'HVAC Block S2', 8.12, 'Đang thực hiện', '2026-09-15', '2027-03-31', 40],
    ['HĐ-2026-022', 'KH-00211', 'Chiller kho lạnh A', 5.6, 'Đã nghiệm thu', '2026-03-21', '2026-08-30', 95], ['HĐ-2026-015', 'KH-00156', 'Điện động lực mở rộng', 6.73, 'Đang thực hiện', '2026-07-18', '2027-01-31', 55],
    ['HĐ-2025-118', 'KH-00211', 'Bảo trì HVAC toàn khu', 1.9, 'Sắp hết hạn', '2025-11-01', '2026-10-31', 100], ['HĐ-2026-019', 'KH-00405', 'VRV khối phòng nghỉ', 2.95, 'Đã nghiệm thu', '2026-02-02', '2026-07-15', 100],
    ['HĐ-2026-024', 'KH-00298', 'BMS & chiller trung tâm', 9.6, 'Đang thực hiện', '2026-06-10', '2027-02-28', 60], ['HĐ-2026-011', 'KH-00177', 'Kho lạnh & thông gió xưởng', 12.3, 'Đang thực hiện', '2026-04-05', '2026-12-20', 75],
    ['HĐ-2026-029', 'KH-00128', 'Thông gió nhà xưởng 2', 1.6, 'Chờ ký', '2026-10-09', '2027-01-15', 0], ['HĐ-2026-026', 'KH-00521', 'Điều hoà khối sơ sinh', 2.4, 'Đang thực hiện', '2026-09-30', '2027-01-30', 20],
  ].map((c) => ({ code: c[0], customerId: c[1], title: c[2], value: c[3] * 1e9, status: c[4], start: c[5], end: c[6], paid: c[7] }));
  const projects = [
    ['DA-2026-014', 'KH-00128', 'HP Tower – HVAC & ELV', 'HVAC, ELV', 18, 'Đúng tiến độ', 'Lâm Văn Hiếu'], ['DA-2026-011', 'KH-00087', 'Sông Xanh – Block S2', 'HVAC, PCCC', 72, 'Trễ 3 ngày', 'Phạm Quang Vinh'],
    ['DA-2026-009', 'KH-00156', 'Phước Long – Điện động lực', 'Điện', 45, 'Đúng tiến độ', 'Trịnh Công Sơn'], ['DA-2026-006', 'KH-00298', 'Vạn Phúc – BMS & chiller', 'HVAC, BMS', 61, 'Đúng tiến độ', 'Lâm Văn Hiếu'],
    ['DA-2026-004', 'KH-00177', 'Đông Á – Kho lạnh', 'Chiller, thông gió', 83, 'Nghiệm thu từng phần', 'Phạm Quang Vinh'], ['DA-2026-015', 'KH-00521', 'Hồng Đức – Khối sơ sinh', 'HVAC phòng sạch', 12, 'Khởi công', 'Trịnh Công Sơn'],
  ].map((p) => ({ code: p[0], customerId: p[1], name: p[2], scope: p[3], progress: p[4], status: p[5], manager: p[6] }));

  const opportunities = [
    ['CH-0412', 'KH-00512', 'HVAC tổng thể tháp A & B', 'Đàm phán', 12.6, 70, 4, 'HVAC', '2026-11-15'], ['CH-0418', 'KH-00342', 'Phòng sạch khối phòng mổ', 'Báo giá', 3.84, 55, 1, 'HVAC', '2026-11-30'],
    ['CH-0421', 'KH-00478', 'Làm mát trung tâm dữ liệu giai đoạn 1', 'Báo giá', 7.2, 45, 1, 'HVAC', '2026-12-20'], ['CH-0409', 'KH-00530', 'Xưởng GMP – AHU', 'Khảo sát', 4.9, 35, 4, 'HVAC', '2027-01-10'],
    ['CH-0402', 'KH-00156', 'Tủ điện MCC mở rộng', 'Đàm phán', 3.05, 65, 2, 'Điện – ELV', '2026-10-30'], ['CH-0425', 'KH-00533', 'Điện động lực nhà máy mới', 'Tiếp cận', 6.4, 15, 0, 'Điện – ELV', '2027-02-28'],
    ['CH-0398', 'KH-00087', 'PCCC Block S3', 'Khảo sát', 4.3, 30, 0, 'PCCC', '2026-12-05'], ['CH-0415', 'KH-00390', 'Bảo trì mở rộng cơ sở 2', 'Tiếp cận', 0.6, 20, 3, 'Bảo trì', '2026-12-15'],
  ].map((o) => ({ id: o[0], customerId: o[1], name: o[2], stage: o[3], value: o[4] * 1e9, prob: o[5], owner: OWNERS[o[6]], dept: o[7], close: o[8] }));

  const approvals = [
    { code: 'BG-2026-121', customerId: 'KH-00342', title: 'Khối phòng mổ – hệ thống phòng sạch', value: 3.84e9, margin: 18.2, by: 'Agent Báo giá', ai: true, submitted: '08/10/2026', dept: 'HVAC' },
    { code: 'BG-2026-118', customerId: 'KH-00512', title: 'HVAC tổng thể tháp A', value: 12.6e9, margin: 16.5, by: 'Phạm Gia Bảo', ai: false, submitted: '06/10/2026', dept: 'HVAC' },
    { code: 'BG-2026-116', customerId: 'KH-00156', title: 'Tủ điện MCC mở rộng', value: 3.05e9, margin: 13.9, by: 'Nguyễn Đức Anh', ai: false, submitted: '04/10/2026', dept: 'Điện – ELV' },
  ];
  const overdue = [
    { invoice: 'HĐ GTGT 0001842', customerId: 'KH-00087', amount: 820e6, due: '15/09/2026', days: 25, dept: 'HVAC' },
    { invoice: 'HĐ GTGT 0001810', customerId: 'KH-00156', amount: 540e6, due: '30/08/2026', days: 41, dept: 'Điện – ELV' },
    { invoice: 'HĐ GTGT 0001851', customerId: 'KH-00298', amount: 310e6, due: '25/09/2026', days: 15, dept: 'HVAC' },
    { invoice: 'HĐ GTGT 0001799', customerId: 'KH-00405', amount: 210e6, due: '20/08/2026', days: 51, dept: 'HVAC' },
    { invoice: 'HĐ GTGT 0001868', customerId: 'KH-00177', amount: 150e6, due: '01/10/2026', days: 9, dept: 'PCCC' },
    { invoice: 'HĐ GTGT 0001744', customerId: 'KH-00455', amount: 70e6, due: '10/07/2026', days: 92, dept: 'Bảo trì' },
  ];
  const contractAlerts = [
    { code: 'HĐ-2026-027', customerId: 'KH-00087', type: 'Mốc thanh toán quá hạn', detail: 'Đợt 3 (30%) quá hạn 12 ngày', tone: 'error', icon: 'circle-alert', dept: 'HVAC' },
    { code: 'HĐ-2025-118', customerId: 'KH-00211', type: 'Sắp hết hạn', detail: 'Hết hạn 31/10/2026 — chưa có phụ lục gia hạn', tone: 'warning', icon: 'calendar-clock', dept: 'Bảo trì' },
    { code: 'HĐ-2026-015', customerId: 'KH-00156', type: 'Bảo lãnh thực hiện', detail: 'Thư bảo lãnh hết hiệu lực 20/10/2026', tone: 'warning', icon: 'shield-alert', dept: 'Điện – ELV' },
    { code: 'HĐ-2026-029', customerId: 'KH-00128', type: 'Chờ ký', detail: 'Hợp đồng 1,6 tỷ đã duyệt, chờ khách hàng ký', tone: 'blue', icon: 'file-pen-line', dept: 'HVAC' },
  ];

  // Monthly series, index 0 = T11/2025 … 11 = T10/2026 (tỷ VNĐ)
  const months = ['T11/25', 'T12/25', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];
  const depts = {
    'HVAC': { rev: [7.1, 8.4, 5.2, 6.0, 7.3, 6.9, 8.6, 8.1, 9.9, 10.4, 11.2, 12.9], margin: 0.19, recv: 9.8, overdueRecv: 1.34 },
    'Điện – ELV': { rev: [2.4, 2.9, 1.8, 2.2, 2.6, 2.3, 2.9, 2.8, 3.1, 3.4, 3.6, 3.7], margin: 0.22, recv: 3.1, overdueRecv: 0.54 },
    'PCCC': { rev: [1.2, 1.5, 0.9, 1.1, 1.4, 1.2, 1.4, 1.3, 1.6, 1.4, 1.7, 1.5], margin: 0.17, recv: 1.6, overdueRecv: 0.15 },
    'Bảo trì': { rev: [0.4, 0.5, 0.4, 0.4, 0.5, 0.4, 0.5, 0.4, 0.6, 0.5, 0.6, 0.5], margin: 0.35, recv: 0.4, overdueRecv: 0.07 },
  };
  const planTotal = [11, 12, 9, 10, 11.5, 11, 13, 13, 14.5, 15, 16, 17.5];
  const stages = [['Tiếp cận', 18, 24], ['Khảo sát', 11, 19], ['Báo giá', 9, 22], ['Đàm phán', 5, 14], ['Thắng (quý này)', 4, 7.4]];

  return { OWNERS, customers, contacts, interactions, quotes, contracts, projects, opportunities, approvals, overdue, contractAlerts, months, depts, planTotal, stages,
    INDUSTRIES: ['Tổng thầu xây dựng', 'Bất động sản', 'Nhà máy – KCN', 'Y tế', 'Dược phẩm', 'Trung tâm dữ liệu', 'Khách sạn – Resort', 'Giáo dục', 'Thương mại – Bán lẻ', 'Điện tử'],
    TIERS: ['Chiến lược', 'VIP', 'Tiềm năng', 'Thường'], STATUSES: ['Đang giao dịch', 'Tiềm năng', 'Tạm ngưng', 'Ngừng giao dịch'],
    SOURCES: ['Giới thiệu', 'Đấu thầu', 'Website', 'Hội chợ triển lãm', 'Khác'],
    CITIES: ['TP. Hồ Chí Minh', 'TP. Thủ Đức', 'Hà Nội', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ', 'Bình Dương', 'Đồng Nai', 'Bà Rịa – Vũng Tàu', 'Long An', 'Hưng Yên', 'Bắc Ninh'],
  };
})();
