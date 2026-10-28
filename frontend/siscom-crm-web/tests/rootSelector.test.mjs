// Run: node --test tests/ — chọn gốc render theo cờ (thuần).
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAppRoot } from '../src/auth/rootSelector.js';

test('mặc định mọi cờ tắt => app (demo localStorage)', () => {
  assert.equal(selectAppRoot({}), 'app');
  assert.equal(selectAppRoot(undefined), 'app');
  assert.equal(selectAppRoot({ VITE_CRM_AUTH_ENABLED: 'false', VITE_CRM_API_ENABLED: 'true' }), 'app');
});
test('VITE_CRM_AUTH_ENABLED=true => auth (ưu tiên hơn preview); chỉ preview => preview', () => {
  assert.equal(selectAppRoot({ VITE_CRM_AUTH_ENABLED: 'true' }), 'auth');
  assert.equal(selectAppRoot({ VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_LOGIN_PREVIEW_ENABLED: 'true' }), 'auth');
  assert.equal(selectAppRoot({ VITE_CRM_LOGIN_PREVIEW_ENABLED: 'true' }), 'preview');
  assert.equal(selectAppRoot({ VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: 'javascript:x' }), 'app'); // base rác => auth tắt
});
