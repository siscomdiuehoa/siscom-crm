// Trang thử cho tests/browser/modalStackChrome.mjs (PR #236, PR236-R2): hai Modal chồng nhau. Hộp B mở từ nút trong hộp A và render ở nhánh DOM
// RIÊNG (giống hộp xác nhận của App.jsx chồng lên hộp khác). Dùng nguyên văn Modal của design system; React thật, trình duyệt thật.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Modal } from '../../../src/ds/feedback/Modal.jsx';

function App() {
  const [a, setA] = React.useState(false);
  const [b, setB] = React.useState(false);
  return (
    <div>
      <button type="button" id="openA" onClick={() => setA(true)}>Mở A</button>
      <button type="button" id="behind">Nút phía sau</button>
      <div id="slotA">
        <Modal open={a} onClose={() => setA(false)} title="Hộp A" footer={<button type="button" id="openB" onClick={() => setB(true)}>Mở B</button>}>
          <input aria-label="A1" id="A1" />
          <input aria-label="A2" id="A2" />
        </Modal>
      </div>
      <div id="slotB">
        <Modal open={b} onClose={() => setB(false)} title="Hộp B" footer={<button type="button" id="cancelB" onClick={() => setB(false)}>Huỷ B</button>}>
          <input aria-label="B1" id="B1" />
          <input aria-label="B2" id="B2" />
        </Modal>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
window.READY = true;
