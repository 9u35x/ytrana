const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/auth.js'), 'utf8');
function load(raw, unavailable = false) {
  const values = new Map([['ytrana_user', raw], ['ytrana_token', 'existing-token']]);
  const context = vm.createContext({
    localStorage: {
      getItem(key) { if (unavailable) throw Error('Storage unavailable'); return values.get(key) || null; },
      removeItem(key) { if (unavailable) throw Error('Storage unavailable'); values.delete(key); },
      setItem(key, value) { values.set(key, value); },
    },
    Api: { getToken: () => values.get('ytrana_token') },
    window: { location: { href: '' } },
  });
  vm.runInContext(source + '\nglobalThis.authForTest = Auth;', context);
  return { auth: context.authForTest, values };
}
for (const raw of ['{bad json', 'null', '[]', 'true', '42', '"text"', '{}', '{"id":0,"username":"bad"}', '{"id":1,"username":null}']) {
  const { auth, values } = load(raw);
  assert.equal(auth.getCurrentUser(), null, raw);
  assert.equal(values.has('ytrana_user'), false);
  assert.equal(values.get('ytrana_token'), 'existing-token', 'Do not erase an otherwise valid token');
}
const valid = load(JSON.stringify({ id: 9, username: 'creator', full_name: 'مبدع' }));
assert.equal(valid.auth.getCurrentUser().username, 'creator');
assert.equal(valid.auth.isLoggedIn(), true);
assert.equal(load('', true).auth.getCurrentUser(), null, 'Restricted storage must not crash rendering');
console.log('AUTH_CACHE_OK: corrupt, invalid and unavailable storage handled without crashing or erasing token');
