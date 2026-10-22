const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const settingsHtml = fs.readFileSync(path.join(root, 'frontend/settings.html'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'frontend/js/settings.js'), 'utf8');
const circlesSource = fs.readFileSync(path.join(root, 'frontend/js/circles.js'), 'utf8');
const postSource = fs.readFileSync(path.join(root, 'frontend/js/post-card.js'), 'utf8');

// Contract-sensitive static checks: the removed no-op control must not be submitted.
assert.equal(settingsHtml.includes('id="activity-visibility"'), false);
assert.equal(settingsSource.includes('activity_visibility: document'), false);
assert.match(settingsSource, /message_privacy: document\.getElementById\("message-privacy"\)\.value/);
assert.match(settingsSource, /content_visibility: document\.getElementById\("content-visibility"\)\.value/);
assert.match(settingsHtml, /id="account-visibility"/);
assert.match(settingsHtml, /id="comment-privacy"/);
assert.match(settingsHtml, /id="show-activity-status"/);
assert.match(settingsSource, /account_visibility:.*comment_privacy/s);
assert.match(settingsSource, /follow-requests/);
assert.match(settingsSource, /profile_updated/);
assert.match(settingsSource, /password_changed/);
assert.match(settingsSource, /URL\.revokeObjectURL/);
assert.match(settingsSource, /origin !== window\.location\.origin/);
assert.match(postSource, /account\/archive\/posts/);
assert.match(circlesSource, /dm-requests\/\$\{encodeURIComponent\(recipient\)\}/);
assert.match(circlesSource, /dm-approvals.*requester_id: Number\(requester_id\)/);
assert.match(circlesSource, /dm-approvals\/\$\{encodeURIComponent\(requester_id\)\}\/\$\{encodeURIComponent\(recipient_id\)\}/);

const nodes = new Map();
const host = { innerHTML: '', querySelectorAll: () => [] };
const document = {
  addEventListener() {},
  getElementById(id) { return nodes.get(id) || host; },
  createElement() { return { _text: '', set textContent(value) { this._text = String(value); }, get textContent() { return this._text; }, get innerHTML() { return this._text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); } }; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
nodes.set('activity-list', host);
nodes.set('archive-list', host);
const calls = [];
const context = {
  document,
  window: { prompt() { return null; } },
  URL,
  URLSearchParams,
  Date,
  console,
  Api: {
    async get(url) { calls.push(['GET', url]); if (url.startsWith('/api/account/activity')) return [
      { type: 'settings_updated', details: 'message_privacy', created_at: '2025-01-01T00:00:00Z' },
      { type: 'archived', target_id: 9, created_at: '2025-01-01T00:00:00Z' },
      { type: 'comment', text: '<unsafe>', created_at: '2025-01-01T00:00:00Z' },
    ]; return [{ id: 9, text: '<unsafe>', is_archived: false, created_at: '2025-01-01T00:00:00Z' }]; },
    async post(url, body) { calls.push(['POST', url, body]); },
    async del(url) { calls.push(['DELETE', url]); },
  },
  showToast() {},
};
vm.createContext(context);
vm.runInContext(`${settingsSource}\nthis.__loadActivity = loadActivity; this.__loadArchive = loadArchive;`, context);
(async () => {
  await context.__loadActivity('all');
  assert.match(host.innerHTML, /تحديث الإعدادات/);
  assert.match(host.innerHTML, /أرشفة محتوى/);
  assert.match(host.innerHTML, /&lt;unsafe&gt;/);
  assert.doesNotMatch(host.innerHTML, />&lt;unsafe&gt;</); // escaped content is not executable markup

  await context.__loadArchive('posts', 'active');
  assert.match(calls.find((c) => c[0] === 'GET' && c[1].includes('include_active=true'))[1], /include_active=true/);
  const action = host.innerHTML.match(/data-archive-action="([^"]+)"/)[1];
  // The rendered action is intentionally tested through the same API shape used by the client.
  await context.Api.post(`/api/account/archive/posts/${encodeURIComponent(action)}`);
  assert.deepEqual(calls.at(-1), ['POST', '/api/account/archive/posts/9', undefined]);

  console.log('test_settings_clients.cjs: all client contract tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
