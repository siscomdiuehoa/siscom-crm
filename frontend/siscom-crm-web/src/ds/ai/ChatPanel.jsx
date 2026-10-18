import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { AgentStatus } from './AgentStatus.jsx';

const now = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

export function ChatPanel({ agent = { name: 'Trợ lý SISCOM', role: 'AI tổng hợp', icon: 'sparkles' }, messages = [], suggestions = [], onSend, placeholder = 'Hỏi AI về khách hàng, dự án, doanh thu…', height = 520, onClose, variant = 'glass' }) {
  const [list, setList] = useState(messages);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const log = useRef(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [list, typing]);
  const send = async (t) => {
    const v = (t ?? text).trim();
    if (!v) return;
    setText('');
    setList((l) => [...l, { from: 'user', text: v, time: now() }]);
    if (!onSend) return;
    setTyping(true);
    try {
      const r = await onSend(v);
      if (r) setList((l) => [...l, typeof r === 'string' ? { from: 'agent', text: r, time: now() } : { from: 'agent', time: now(), ...r }]);
    } finally { setTyping(false); }
  };
  return (
    <section className={'sg-chat ' + (variant === 'solid' ? 'sg-solid' : 'sg-glass')} style={{ height }}>
      <header className="sg-chat__head">
        <Avatar ai square icon={agent.icon || 'bot'} size={36} name={agent.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: 'var(--fw-semibold) var(--fs-sm)/18px var(--font-sans)' }}>{agent.name}</div>
          <AgentStatus status={typing ? 'processing' : 'active'} label={typing ? 'Đang soạn trả lời…' : agent.role} />
        </div>
        <IconButton icon="history" label="Lịch sử" size="sm" />
        {onClose ? <IconButton icon="x" label="Đóng" size="sm" onClick={onClose} /> : null}
      </header>
      <div className="sg-chat__log sg-scroll" ref={log}>
        {list.map((m, i) => (
          <div key={i} className={'sg-msg' + (m.from === 'user' ? ' sg-msg--user' : '')}>
            {m.from !== 'user' ? <Avatar ai square icon={agent.icon || 'bot'} size={28} /> : null}
            <div style={{ minWidth: 0 }}>
              <div className="sg-msg__bubble">{m.text}{m.attachment ? <div style={{ marginTop: 10 }}>{m.attachment}</div> : null}</div>
              <div className="sg-msg__meta" style={m.from === 'user' ? { textAlign: 'right' } : undefined}>{m.time}{m.from !== 'user' && m.sources ? ' · ' + m.sources : ''}</div>
            </div>
          </div>
        ))}
        {typing ? (
          <div className="sg-msg"><Avatar ai square icon={agent.icon || 'bot'} size={28} /><div className="sg-msg__bubble"><span className="sg-typing"><i /><i /><i /></span></div></div>
        ) : null}
      </div>
      <div className="sg-chat__composer">
        {suggestions.length && list.length < 3 ? (
          <div className="sg-suggest">{suggestions.map((s) => <button key={s} type="button" className="sg-chip" onClick={() => send(s)}><Icon name="sparkles" size={13} color="var(--accent)" />{s}</button>)}</div>
        ) : null}
        <form className="sg-control" style={{ height: 44, paddingRight: 6 }} onSubmit={(e) => { e.preventDefault(); send(); }}>
          <IconButton icon="paperclip" label="Đính kèm" size="sm" />
          <input className="sg-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Nội dung tin nhắn" />
          <button type="submit" className="sg-btn sg-btn--ai sg-iconbtn sg-btn--sm" aria-label="Gửi" disabled={!text.trim()}><Icon name="send" size={15} /></button>
        </form>
        <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', textAlign: 'center' }}>AI có thể sai sót — hãy kiểm tra số liệu quan trọng trước khi gửi khách hàng.</div>
      </div>
    </section>
  );
}
