import React from 'react';

// SISCOM Login V3 — cảnh minh hoạ ĐIỆN GIÓ (SVG thuần, không thư viện, không tải ảnh ngoài, không bản quyền): đồi, 4 tuabin gió, cánh quay.
// Nét vẽ dùng currentColor (màu mực của V3) nên đổi màu bằng CSS; nằm trên nền loang màu pastel. Muốn dùng ẢNH/VIDEO THẬT của công trình,
// đặt LOGIN_HERO_PHOTO (LoginScreen.jsx) = URL ảnh; ảnh thay cảnh này.
// Trang trí thuần tuý: aria-hidden, không nhận focus. Cánh quay tắt khi người dùng chọn giảm chuyển động.
const TURBINES = [
  { x: 560, y: 250, s: 1.25, d: 9 },
  { x: 330, y: 330, s: 0.85, d: 12 },
  { x: 710, y: 360, s: 0.7, d: 14 },
  { x: 150, y: 400, s: 0.6, d: 16 },
];
const BLADES = [0, 120, 240];

function Turbine({ x, y, s, d }) {
  const tower = 300; // chiều cao tháp (đơn vị gốc)
  return (
    <g transform={'translate(' + x + ' ' + y + ') scale(' + s + ')'}>
      <path d={'M-5 ' + tower + 'L-2.2 0H2.2L5 ' + tower + 'Z'} fill="url(#lg3-metal)" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.2" />
      <rect x="-5" y="-7" width="22" height="14" rx="6" fill="currentColor" fillOpacity=".35" />
      <g className="lg3-spin" style={{ animationDuration: d + 's' }}>
        <circle r="120" fill="none" />
        {BLADES.map((a) => (
          <path key={a} d="M-4.5 0C-5 -30 -3 -85 0 -118C3 -85 5 -30 4.5 0Z" fill="currentColor" fillOpacity=".42" stroke="currentColor" strokeOpacity=".5" strokeWidth="1" transform={'rotate(' + a + ')'} />
        ))}
      </g>
      <circle r="8" fill="currentColor" fillOpacity=".75" />
    </g>
  );
}

export default function LoginHeroScene() {
  return (
    <svg className="lg3-scene" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lg3-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity=".12" />
          <stop offset=".5" stopColor="currentColor" stopOpacity=".34" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".16" />
        </linearGradient>
      </defs>
      {/* mây mỏng */}
      <g fill="currentColor" fillOpacity=".08">
        <ellipse cx="170" cy="120" rx="110" ry="16" />
        <ellipse cx="250" cy="138" rx="80" ry="12" />
        <ellipse cx="640" cy="90" rx="120" ry="14" />
      </g>
      {/* đồi xa → gần */}
      <path d="M0 430C120 380 240 400 360 380C500 356 640 392 800 350V560H0Z" fill="currentColor" fillOpacity=".10" />
      {TURBINES.slice(2).map((t) => <Turbine key={t.x} {...t} />)}
      <path d="M0 480C140 440 300 462 440 440C580 418 700 452 800 430V560H0Z" fill="currentColor" fillOpacity=".14" />
      {TURBINES.slice(0, 2).map((t) => <Turbine key={t.x} {...t} />)}
      <path d="M0 520C180 496 320 512 480 500C620 490 720 508 800 498V560H0Z" fill="currentColor" fillOpacity=".18" />
    </svg>
  );
}
