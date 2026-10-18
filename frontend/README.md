# SISCOM CRM — Web (React + Vite)

Phase-1 migration of the SISCOM CRM prototype (React 18 UMD + in-browser Babel) to a normal **React 18 + Vite** project. Same UI, same Liquid Glass design system, same demo data in `localStorage`. **No backend, no Tailwind/shadcn, no TypeScript, no StrictMode** in this phase.

## Run on Windows

### 1. Install Node.js (once)
Install the **LTS (version 20 or newer)** from https://nodejs.org (or in PowerShell: `winget install OpenJS.NodeJS.LTS`). Close and reopen the terminal, then check:

```bat
node -v
npm -v
```

### 2. Easiest: double-click `start-crm.bat`
It checks for Node.js, runs `npm install` the first time, starts the dev server and opens http://localhost:5173.

### 3. Or use the commands
Open **Command Prompt** (not PowerShell — see Troubleshooting) in this folder (`cd /d C:\path\to\siscom-crm-web`):

```bat
npm install        :: first time only (downloads react, vite)
npm run dev        :: dev server -> http://localhost:5173
npm run build      :: production build -> dist\
npm run preview    :: serve dist\ -> http://localhost:4173
```

`npm install` creates `package-lock.json`; keep it (commit it) so everyone gets identical versions.

## What is where
```
index.html            Vite entry (lang="vi", <body class="sg-ambient">)
src/main.jsx          createRoot (no StrictMode), imports CSS
src/App.jsx           app shell: sidebar, topbar, hash routing, theme (light/dark/system), toasts, dialogs, AI chat
src/pages/            Dashboard.jsx, CustomerList.jsx, CustomerProfile.jsx
src/features/customers/  CustomerForm.jsx (add/edit drawer), CustomerIO.jsx (import/export)
src/data/             demoData.js (ILLUSTRATIVE demo data), util.js (formatters, validators, CSV)
src/ds/               the 29 design-system component files (38 exports), copied unchanged; index.js = barrel
src/styles/           tokens/*.css, components/*.css, assets/(fonts, Lucide icon font), styles.css, app.css
src/assets/           logo-siscom.png
vite.config.js  package.json  .nvmrc  start-crm.bat
```
CSS import order in `src/styles/styles.css` is identical to the design system (Liquid Glass last); the only change is `./` prefixes so Vite resolves the `@import`s.

## B0 — Platform hardening (done in this version)
- **Repository layer** `src/data/repository/`: `storage.js` (adapter), `schema.js` (schema v2, migrations, backups, boot), `mutations.js` (business rules + permission checks + audit log), `ids.js` (collision-safe ids).
- **Migration v1 → v2:** on first start the old `siscom-crm-demo-v1` data is read, **backed up** to `siscom-crm-backup-v1-<time>`, then converted and saved to `siscom-crm-db-v2`. The old key is **never modified or deleted** (rollback = use the previous version). If backup/migration cannot be done safely the app goes **read-only** and writes nothing.
- **Fixes:** `nextId`/import numbering no longer breaks on an empty list; contact/interaction ids no longer use `Date.now()`; duplicate MST is enforced in the repository too; delete is now **soft delete** and is **blocked** while the customer still has open contracts/quotes/projects/opportunities; Dashboard approve/reject now persists (approval + quote status) and is audit-logged.
- **Permissions (DEMO):** role switcher in the top bar (hidden below 1100px). Matrix in `src/auth/permissions.js` is a placeholder pending SISCOM's real roles; it is UI/repository guarding only, **not security**. Default user = Giám đốc (full access, same behaviour as before).
- **Backup tools:** banner links "Xuất sao lưu" (JSON file) / "Nhập sao lưu" / "Khôi phục dữ liệu mẫu" (auto-backup first; last 3 auto-backups kept).
- **Tests:** open `tests/b0-repository.test.html` through the dev server (`http://localhost:5173/tests/b0-repository.test.html`) — 50 checks, uses an in-memory fake storage, never touches real data.
- **Backend prep:** `docs/BACKEND_READINESS.md`, `docs/postgres-schema.sql` (design only).

## Customer rules (optional fields update)
- **Only 2 required fields:** Tên công ty và Điện thoại. Everything else is optional; if filled it must be well-formed.
- **One rule set** in `src/data/customerRules.js` is used by the Form, the Repository (`mutations.js`) and CSV Import: `validateCustomer`, `normalizeCustomer`, `getCustomerDefaults`.
- **Phone:** Vietnamese (10–11 digits, `0…`, `+84…`, `0084…`) or international `+<country><number>` (8–15 digits).
- **MST:** may be blank; if filled → format check + duplicate check. Blank MSTs are never duplicates; soft-deleted customers don't block reuse.
- **Defaults:** phân hạng/trạng thái default to "Tiềm năng". Configurable via `setCustomerDefaults({ tier, status })` (stored in `siscom-crm-customer-defaults`; values outside the allowed lists are ignored). No UI for this yet.
- **No fabricated data:** owner, industry, source, address, city, email, website stay empty when not entered. The short name is derived from the company name when left blank (as before). Import no longer fills a default industry/owner/source.
- **Legacy data:** nothing is rewritten. When editing an old record, format errors on values you did not change are not raised (e.g. old demo phones such as `0274…` with 12 digits); required fields still are.
- Lists/profile show "—" or "Chưa phân công" for empty fields.
- **Tests:** `tests/customer-optional-fields.test.html` (64 checks) and `tests/b0-repository.test.html` (50 checks, regression).

## Behaviour preserved
- Routes (hash): `#/dashboard`, `#/customers`, `#/customers/KH-00128`; other modules show the "chờ duyệt giai đoạn 1" placeholder.
- localStorage keys unchanged: `siscom-crm-demo-v1` (customers/contacts/interactions) and `siscom-crm-theme` (`light` | `dark` | `system`). Data saved by the legacy app on the same origin is read as-is.
- Fixed-state preview (QA): `http://localhost:5173/?route=/dashboard&theme=dark` (replaces the old `window.KIT_INIT`; writes nothing to localStorage).
- All Vietnamese labels, Liquid Glass hover/lift effects, `prefers-reduced-motion` handling, responsive layouts.
- The demo banner stays: all customers and figures are **illustrative demo data**, not real records.

## Verification status (be honest)
Done in the authoring environment (no Node/npm available there):
- ✅ Every relative `import` resolves to an existing file; every named import exists as an export of its target (static script).
- ✅ No leftover `window.APP_*`, `window.SISCOMHybridGlassUI_*`, `window.KIT_INIT`, `window.<Page>` references in `src/`.
- ✅ All `.jsx` files parse (JSX syntax) with Babel in a browser.
- ✅ CSS/assets copied with unchanged relative layout (`tokens/fonts.css` → `../assets/fonts/*.woff2`).

**NOT performed (needs Node/npm — please run these):**
- ❌ `npm install` (dependency resolution), `npm run dev`, `npm run build`, `npm run preview`.
- ❌ Runtime check in the Vite dev server (console errors, 404s for fonts/icons/logo).
- ❌ Visual parity vs legacy at 1440/1280/1024/768/390, light/dark/system, hover layout-shift check.
- ❌ localStorage persistence test across reloads in the new build.
- ❌ Windows-specific test of `start-crm.bat`.
Checklist: `docs/MIGRATION_PLAN.md` §8 (in the design-system project).

## Troubleshooting (Windows)
- **PowerShell: "running scripts is disabled"** → use Command Prompt, or run `Set-ExecutionPolicy -Scope Process Bypass` in that PowerShell window, then retry.
- **`node` / `npm` not recognized** → reopen the terminal after installing Node; reinstall with "Add to PATH".
- **Port 5173 in use** → Vite picks the next free port and prints it; or `npm run dev -- --port 3000`.
- **`npm install` fails behind a proxy** → `npm config set proxy http://host:port` and `npm config set https-proxy http://host:port`.
- **Blank page / odd data** → open DevTools → Application → Local Storage → delete `siscom-crm-demo-v1` (or click "Khôi phục dữ liệu mẫu" in the app).
- **Vietnamese text looks broken in `.bat` output** → run `chcp 65001` first (the .bat does).
- **Serve `dist/` without Vite** → `npx serve dist` (relative `base: './'` is set; hash routing needs no rewrites).

## Known limits after B0
- Soft-deleted customers cannot be restored from the UI yet (data stays in the db/backup/audit log).
- Dashboard charts/pipeline series and the "insight" text are still static demo constants (`demoData.js`); only opportunities, alerts, approvals and customer-profile tabs read from the stored db.
- localStorage is single-user, unencrypted, ~5 MB.

## Next phases (not started)
TypeScript, React Router, a real API layer replacing localStorage, tests, StrictMode, other modules.
