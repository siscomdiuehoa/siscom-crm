// Trích "sự thật hợp đồng" từ MÃ NGUỒN backend (chỉ đọc file, không import TS, không DB, không Nest, không mạng).
// Mục đích: mock HTTP của frontend không còn là bản tự viết tay — mọi hằng số (trường bắt buộc, trường được phép, giới hạn trang,
// mã lỗi, regex type lookups, CORS) lấy từ chính file backend. Backend đổi => test frontend đỏ, không âm thầm xanh.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const BACKEND_SRC = join(REPO_ROOT, 'backend', 'src');
const read = (rel) => readFileSync(join(BACKEND_SRC, ...rel.split('/')), 'utf8');

// Các dòng "decorator(s)" + dòng khai báo trường của một DTO class-validator: [{ name, optional, decorators }]
export function dtoFields(rel) {
  const lines = read(rel).split(/\r?\n/);
  const out = []; let deco = '';
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^(\w+)(\?)?!?\s*:\s*[^;]+;$/.exec(line);
    if (m && deco) { out.push({ name: m[1], optional: !!m[2], decorators: deco }); deco = ''; } else if (line.startsWith('@')) deco += ' ' + line;
    else if (!line.startsWith('//')) deco = '';
  }
  return out;
}
const field = (fields, n) => fields.find((f) => f.name === n);
const messageOf = (f) => { const m = /IsNotEmpty\(\{\s*message:\s*'([^']+)'/.exec(f.decorators); return m ? m[1] : null; };

export function loadFacts() {
  const create = dtoFields('modules/customers/dto/create-customer.dto.ts');
  const update = dtoFields('modules/customers/dto/update-customer.dto.ts');
  const query = dtoFields('modules/customers/dto/query-customers.dto.ts');
  const defaults = read('modules/customers/customers.defaults.ts');
  const errorsSrc = read('modules/customers/customers.errors.ts');
  const filterSrc = read('common/filters/all-exceptions.filter.ts');
  const lookupDto = read('modules/lookups/dto/query-lookups.dto.ts');
  const setup = read('app.setup.ts');
  const service = read('modules/customers/customers.service.ts');

  const domainErrors = {}; // code -> status
  for (const m of errorsSrc.matchAll(/new DomainException\((\d+),\s*'([A-Z_]+)'/g)) domainErrors[m[2]] = Number(m[1]);
  const codesBlock = /const CODES[^{]*\{([\s\S]*?)\};/.exec(filterSrc);
  const filterCodes = {}; // status -> code (lỗi không phải DomainException)
  if (codesBlock) for (const m of codesBlock[1].matchAll(/(\d+):\s*'([A-Z_]+)'/g)) filterCodes[Number(m[1])] = m[2];
  const lookupTypeRe = /@Matches\(\/(.+?)\/,/.exec(lookupDto);
  const sortFields = /SORT_FIELDS\s*=\s*\[([^\]]+)\]/.exec(defaults);
  const lookupTypes = {}; // field -> type
  const lt = /LOOKUP_TYPES\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(defaults);
  if (lt) for (const m of lt[1].matchAll(/(\w+):\s*'(\w+)'/g)) lookupTypes[m[1]] = m[2];
  const listReturn = /return \{ items: [^}]*\}/.exec(service);
  const corsMethods = /methods:\s*\[([^\]]*)\]/.exec(setup);
  const corsHeaders = /allowedHeaders:\s*\[([^\]]*)\]/.exec(setup);
  const list = (s) => (s ? [...s[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []);

  return {
    create: { fields: create.map((f) => f.name), required: create.filter((f) => !f.optional).map((f) => f.name), nameMsg: messageOf(field(create, 'name')), phoneMsg: messageOf(field(create, 'phone')), nameMin: Number((/MinLength\((\d+)/.exec(field(create, 'name').decorators) || [])[1]) },
    update: { fields: update.map((f) => f.name), required: update.filter((f) => !f.optional).map((f) => f.name) },
    query: {
      fields: query.map((f) => f.name),
      pageSizeMax: Number((/@Max\((\d+)\)/.exec(field(query, 'pageSize').decorators) || [])[1]),
      searchMin: Number((/MinLength\((\d+)/.exec(field(query, 'search').decorators) || [])[1]),
      sortFields: sortFields ? [...sortFields[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [],
    },
    domainErrors, filterCodes, lookupTypes,
    lookupTypeRe: lookupTypeRe ? new RegExp(lookupTypeRe[1]) : null,
    listKeys: listReturn ? ['items', 'page', 'pageSize', 'total', 'totalPages'].filter((k) => new RegExp('\\b' + k + '\\b').test(listReturn[0])) : [],
    cors: { methods: list(corsMethods), allowedHeaders: list(corsHeaders), credentialsFalse: /credentials:\s*false/.test(setup) },
    // Các message tùy biến của DTO (details trả về client là chuỗi message, KHÔNG kèm tên thuộc tính)
    customMessages: [...[...create, ...update].flatMap((f) => [...f.decorators.matchAll(/message:\s*'([^']+)'/g)].map((m) => ({ property: f.name, message: m[1] })))],
  };
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const prodFiles = () => walk(BACKEND_SRC).filter((f) => !/\.(spec|test)\.ts$/.test(f));

// Trạng thái các điểm mà frontend cần nhưng backend (nhánh hiện tại) có thể chưa có. Đọc từ mã nguồn, không suy đoán.
export function probeBackendAvailability() {
  const prod = prodFiles();
  const text = (f) => readFileSync(f, 'utf8');
  const authControllers = prod.filter((f) => /@Controller\(\s*['"`]auth/.test(text(f)));
  const actorProviders = prod.filter((f) => /implements\s+ActorProvider\b/.test(text(f)));
  const guardedControllers = ['modules/customers/customers.controller.ts', 'modules/lookups/lookups.controller.ts']
    .map((r) => ({ file: r, guarded: /@UseGuards\(ActorGuard\)/.test(read(r)), isPublic: /@Public\s*\(/.test(read(r)) }));
  return { authControllers, actorProviders, guardedControllers, hasAccessGuard: prod.some((f) => /class AccessGuard\b/.test(text(f))) };
}
