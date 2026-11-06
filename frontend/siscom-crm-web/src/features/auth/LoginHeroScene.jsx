import React from 'react';

// SISCOM Login V3 — cảnh minh hoạ HVAC/MEP (SVG thuần, không thư viện, không tải ảnh ngoài, không bản quyền).
// Dùng làm nền khung bên trái, phủ gradient xanh thương hiệu bằng CSS. Muốn dùng ẢNH THẬT của công trình:
// đặt LOGIN_HERO_PHOTO (LoginScreen.jsx) = URL ảnh; ảnh thay cảnh này, lớp phủ xanh giữ nguyên.
// Trang trí thuần tuý: aria-hidden, không nhận focus. Chuyển động (quạt, dòng chảy ống) tắt khi người dùng chọn giảm chuyển động.
export default function LoginHeroScene() {
  const blades = [0, 60, 120, 180, 240, 300];
  return (
    <svg className="lg3-scene" viewBox="0 236 800 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="lg3-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth="1" />
        </pattern>
        <linearGradient id="lg3-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset="1" stopColor="#fff" stopOpacity=".05" />
        </linearGradient>
        <linearGradient id="lg3-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dd3fc" stopOpacity=".28" />
          <stop offset="1" stopColor="#7dd3fc" stopOpacity="0" />
        </linearGradient>
        <g id="lg3-fan">
          <circle r="46" fill="rgba(8,20,60,.35)" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
          <g className="lg3-spin">
            {blades.map((a) => <path key={a} d="M0 0C14 -10 26 -24 18 -38C8 -30 2 -16 0 0Z" fill="#fff" fillOpacity=".38" transform={'rotate(' + a + ')'} />)}
          </g>
          <circle r="6" fill="#fff" fillOpacity=".8" />
        </g>
      </defs>

      <rect y="200" width="800" height="700" fill="url(#lg3-grid)" />

      {/* sàn mái + bóng */}
      <rect x="0" y="705" width="800" height="120" fill="url(#lg3-floor)" />
      <path d="M0 705H800" stroke="#fff" strokeOpacity=".45" strokeWidth="2" />

      {/* đường ống nước lạnh / nóng từ chiller sang AHU */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M395 690V742H165V700" stroke="#38bdf8" strokeOpacity=".75" strokeWidth="9" />
        <path d="M425 690V762H195V700" stroke="#34d399" strokeOpacity=".7" strokeWidth="9" />
        <path className="lg3-flow" d="M395 690V742H165V700" stroke="#fff" strokeOpacity=".9" strokeWidth="2.5" strokeDasharray="2 16" />
        <path className="lg3-flow lg3-flow--rev" d="M425 690V762H195V700" stroke="#fff" strokeOpacity=".9" strokeWidth="2.5" strokeDasharray="2 16" />
      </g>

      {/* AHU */}
      <g>
        <rect x="70" y="470" width="270" height="235" rx="10" fill="url(#lg3-metal)" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
        <path d="M70 540H340M70 610H340" stroke="#fff" strokeOpacity=".25" strokeWidth="1.5" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={'M' + (92 + i * 11) + ' 560V595'} stroke="#fff" strokeOpacity=".4" strokeWidth="2" />)}
        <use href="#lg3-fan" transform="translate(245 600) scale(.95)" />
        <rect x="86" y="486" width="74" height="40" rx="6" fill="rgba(8,20,60,.35)" stroke="#fff" strokeOpacity=".4" />
        <circle cx="106" cy="506" r="5" fill="#34d399" />
        <path d="M120 506H146" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
      </g>

      {/* ống gió chính */}
      <g>
        <rect x="170" y="330" width="62" height="140" fill="url(#lg3-metal)" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
        <rect x="170" y="268" width="560" height="62" fill="url(#lg3-metal)" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
        {[230, 290, 350, 410, 470, 530, 590, 650].map((x) => <path key={x} d={'M' + x + ' 268V330'} stroke="#fff" strokeOpacity=".3" strokeWidth="2" />)}
        <path d="M170 470H232M170 462H232" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
        {/* miệng gió */}
        {[300, 450, 600].map((x) => (
          <g key={x}>
            <path d={'M' + (x - 18) + ' 330V352'} stroke="#fff" strokeOpacity=".45" strokeWidth="2" />
            <rect x={x - 34} y="352" width="68" height="14" rx="3" fill="rgba(255,255,255,.18)" stroke="#fff" strokeOpacity=".55" />
            {[-20, -8, 4, 16].map((d) => <path key={d} d={'M' + (x + d) + ' 356V362'} stroke="#fff" strokeOpacity=".6" />)}
          </g>
        ))}
        <path d="M730 268V330" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
      </g>

      {/* chiller */}
      <g>
        <rect x="395" y="500" width="250" height="205" rx="10" fill="url(#lg3-metal)" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
        <path d="M395 560H645" stroke="#fff" strokeOpacity=".25" strokeWidth="1.5" />
        <use href="#lg3-fan" transform="translate(470 500) scale(.72)" />
        <use href="#lg3-fan" transform="translate(570 500) scale(.72)" />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => <path key={i} d={'M' + (415 + i * 16) + ' 585V690'} stroke="#fff" strokeOpacity=".22" strokeWidth="2" />)}
      </g>

      {/* tháp giải nhiệt */}
      <g>
        <path d="M672 705L690 520H770L788 705Z" fill="url(#lg3-metal)" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
        <path d="M680 640H780M685 590H775" stroke="#fff" strokeOpacity=".25" />
        <use href="#lg3-fan" transform="translate(730 520) scale(.62)" />
      </g>

      {/* khung thép + giá đỡ */}
      <path d="M40 705V420M40 420H70M760 330V705" stroke="#fff" strokeOpacity=".18" strokeWidth="3" />
      <g stroke="#fff" strokeOpacity=".5" strokeWidth="1.2" fill="none" strokeDasharray="4 6">
        <path d="M70 450H340M395 480H645" />
      </g>
    </svg>
  );
}
