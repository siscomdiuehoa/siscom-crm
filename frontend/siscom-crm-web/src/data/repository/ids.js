// Collision-safe ids for child records (contacts, interactions, audit). Business codes (KH-00001) use maxNo() and never Math.max(...[]).
let seq = 0;
export function uid(prefix) {
  seq = (seq + 1) % 1296;
  const rnd = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  return (prefix + '-' + Date.now().toString(36) + seq.toString(36).padStart(2, '0') + rnd).toUpperCase();
}
export function maxNo(list, prefix) {
  let m = 0;
  for (const x of list) { const id = x && x.id || ''; if (id.startsWith(prefix)) { const n = parseInt(id.slice(prefix.length), 10); if (!isNaN(n) && n > m) m = n; } }
  return m;
}
export const pad = (n, w = 5) => String(n).padStart(w, '0');
