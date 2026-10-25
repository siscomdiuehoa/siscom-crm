// Single source of truth for customer validation/normalisation. Used by the Form, the Repository (mutations.js) and CSV Import.
// Required: name + phone ONLY. Everything else is optional; if filled it must be well-formed. Blank MST is never a duplicate.
import * as U from './util.js';
import { storage } from './repository/storage.js';
import { APP_DATA } from './demoData.js';

export const BASE_DEFAULTS = { tier: 'Tiềm năng', status: 'Tiềm năng' };
export const DEFAULTS_KEY = 'siscom-crm-customer-defaults';
export const REQUIRED_FIELDS = ['name', 'phone'];
export const MSG = {
  name: 'Vui lòng nhập tên công ty', nameShort: 'Tên công ty quá ngắn', phone: 'Vui lòng nhập số điện thoại',
  phoneFmt: 'Số điện thoại chưa hợp lệ: số Việt Nam gồm 10–11 chữ số (bắt đầu 0 hoặc +84); số quốc tế dạng +<mã nước><số>',
  taxFmt: 'MST gồm 10 chữ số, hoặc 13 chữ số dạng 0123456789-001', email: 'Email chưa đúng định dạng', website: 'Website chưa đúng định dạng (VD: congty.vn)',
};
const s = (v) => String(v == null ? '' : v).trim();
// Zero-width chars are not stripped by trim(): a name made only of them looks empty to people but would pass the length check.
const blankName = (v) => !s(String(v == null ? '' : v).replace(/[​-‍⁠﻿]/g, ''));

// Configurable defaults for tier/status (only values from the allowed lists are accepted).
export function getCustomerDefaults() {
  const out = { ...BASE_DEFAULTS };
  try {
    const o = JSON.parse(storage.get(DEFAULTS_KEY) || 'null');
    if (o && APP_DATA.TIERS.includes(o.tier)) out.tier = o.tier;
    if (o && APP_DATA.STATUSES.includes(o.status)) out.status = o.status;
  } catch (e) { /* ignore corrupt config */ }
  return out;
}
export function setCustomerDefaults(p) { return storage.set(DEFAULTS_KEY, JSON.stringify({ ...getCustomerDefaults(), ...p })); }

// opts.customers: existing records (soft-deleted ignored); opts.selfId: id being edited; opts.original: record before edit —
// format errors on values left UNCHANGED from legacy data are not raised (required-ness still is).
export function validateCustomer(c, opts = {}) {
  const { customers = [], selfId, original } = opts; const e = {};
  const same = (k) => !!original && s(original[k]) === s(c[k]);
  if (blankName(c.name)) e.name = MSG.name; else if (s(c.name).length < 2) e.name = MSG.nameShort;
  if (!s(c.phone)) e.phone = MSG.phone; else if (!U.isPhone(c.phone) && !same('phone')) e.phone = MSG.phoneFmt;
  const tax = s(c.taxId);
  if (tax) {
    if (!U.isTax(tax)) { if (!same('taxId')) e.taxId = MSG.taxFmt; }
    else { const dup = customers.find((k) => !k.deletedAt && k.id !== selfId && s(k.taxId) && s(k.taxId) === tax); if (dup) e.taxId = 'MST đã tồn tại ở khách hàng ' + dup.id + ' (' + dup.short + ')'; }
  }
  if (s(c.email) && !U.isEmail(c.email) && !same('email')) e.email = MSG.email;
  if (s(c.website) && !U.isUrl(c.website) && !same('website')) e.website = MSG.website;
  return e;
}

export function normalizeCustomer(c, defaults = getCustomerDefaults()) {
  const name = s(c.name);
  return { ...c, name, short: s(c.short) || name.replace(/^(Công ty|Cty)\s+(CP|TNHH|Cổ phần)\s*/i, '') || name,
    taxId: s(c.taxId), industry: s(c.industry), owner: s(c.owner), source: s(c.source), address: s(c.address), city: s(c.city),
    phone: s(c.phone), email: s(c.email), website: s(c.website), note: s(c.note),
    tier: s(c.tier) || defaults.tier, status: s(c.status) || defaults.status };
}
