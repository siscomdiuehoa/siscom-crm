// Pure mapping between the UI customer model (data/demoData.js, CustomerForm) and the backend Customers API (B1.2.3 DTOs).
// No network, no storage, no React. Backend field names: shortName, province; tier/status/industry/source/province are lookup CODES.
// The UI keeps Vietnamese labels; labels <-> codes come from GET /lookups (see buildLookupMaps). Owner is never sent (backend takes it from the actor).

export class AdapterError extends Error {
  constructor(message, field) { super(message); this.name = 'AdapterError'; this.field = field; }
}

// UI field -> backend lookup type (GET /lookups?type=...)
export const LOOKUP_FIELDS = { tier: 'customer_tier', status: 'customer_status', industry: 'industry', source: 'source', city: 'province' };

const s = (v) => String(v == null ? '' : v).trim();

// lookupsResponse = `data` of GET /lookups: { customer_tier: [{ code, label }], ... } -> { tier: { toCode(label), toLabel(code), options: [label...], missing }, ... }
// `options` = server labels in server order (only well-formed rows; nothing invented). `missing` = the type was absent/not a list in the response.
export function buildLookupMaps(lookupsResponse) {
  const out = {};
  for (const [field, type] of Object.entries(LOOKUP_FIELDS)) {
    const raw = lookupsResponse && lookupsResponse[type];
    const missing = !Array.isArray(raw);
    const rows = (missing ? [] : raw).filter((r) => r && typeof r.code === 'string' && r.code && typeof r.label === 'string' && r.label.trim());
    const byLabel = new Map(); const byCode = new Map();
    for (const r of rows) { if (!byLabel.has(r.label)) byLabel.set(r.label, r.code); if (!byCode.has(r.code)) byCode.set(r.code, r.label); }
    out[field] = { toCode: (label) => byLabel.get(label), toLabel: (code) => byCode.get(code), options: [...byLabel.keys()], missing };
  }
  return out;
}

function code(ui, field, maps) {
  const label = s(ui[field]);
  if (!label) return null;
  const c = maps && maps[field] && maps[field].toCode(label);
  if (!c) throw new AdapterError('Giá trị "' + label + '" của trường ' + field + ' không có trong danh mục máy chủ.', field);
  return c;
}

// mode 'create' -> body for POST /customers: empty optionals are OMITTED. Requires name + phone.
// mode 'update' -> body for PATCH /customers/:id: empty optionals are sent as null (= clear); `version` (optimistic lock) is required.
export function toApiCustomer(ui, maps, opts = {}) {
  const mode = opts.mode || 'create';
  if (!ui) throw new AdapterError('Thiếu dữ liệu khách hàng.');
  const name = s(ui.name); const phone = s(ui.phone);
  if (!name) throw new AdapterError('Vui lòng nhập tên công ty', 'name');
  if (!phone) throw new AdapterError('Vui lòng nhập số điện thoại', 'phone');
  const body = { name, phone };
  if (mode === 'update') {
    if (!Number.isInteger(opts.version) || opts.version < 1) throw new AdapterError('Thiếu version (khoá lạc quan) để cập nhật.', 'version');
    body.version = opts.version;
  } else if (mode !== 'create') throw new AdapterError('mode không hợp lệ: ' + mode);
  const optional = { shortName: s(ui.short), taxId: s(ui.taxId), address: s(ui.address), email: s(ui.email), website: s(ui.website), note: s(ui.note),
    industry: code(ui, 'industry', maps), source: code(ui, 'source', maps), province: code(ui, 'city', maps) };
  for (const [k, v] of Object.entries(optional)) { if (v) body[k] = v; else if (mode === 'update') body[k] = null; }
  // tier/status are NOT NULL on the backend: only sent when chosen (create falls back to server defaults).
  const tier = code(ui, 'tier', maps); const status = code(ui, 'status', maps);
  if (tier) body.tier = tier;
  if (status) body.status = status;
  if (Array.isArray(ui.tags)) body.tags = ui.tags.map(s).filter(Boolean);
  return body;
}

// api = one item of `data` from GET /customers/:id (detail) or GET /customers (list item, fewer fields). Missing optionals become ''.
export function fromApiCustomer(api) {
  if (!api || !api.id) throw new AdapterError('Phản hồi khách hàng không hợp lệ (thiếu id).');
  const lbl = (l) => (l && typeof l.label === 'string' && l.label) || '';
  const str = (v) => (typeof v === 'string' ? v : ''); // response is untrusted: non-string (object/array/number/null) -> '' (fail-closed); never reaches .replace()/render
  const revenue = api.revenueVnd == null ? 0 : Number(api.revenueVnd);
  return {
    id: api.id, // stable id = backend uuid; business code is kept separately
    code: str(api.code),
    name: str(api.name), short: str(api.shortName), taxId: str(api.taxId),
    industry: lbl(api.industry), tier: lbl(api.tier), status: lbl(api.status), source: lbl(api.source), city: lbl(api.province),
    owner: (api.owner && str(api.owner.fullName)) || '', ownerId: (api.owner && api.owner.id) || null,
    address: str(api.address), phone: str(api.phone), email: str(api.email), website: str(api.website), note: str(api.note),
    tags: Array.isArray(api.tags) ? [...api.tags] : [],
    revenue: Number.isFinite(revenue) ? revenue : 0,
    version: api.version, createdAt: api.createdAt || '', updatedAt: api.updatedAt || '', deletedAt: api.deletedAt || null,
  };
}
