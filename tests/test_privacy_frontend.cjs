#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'frontend/js/settings.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/settings.html'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'frontend/js/profile.js'), 'utf8');

// All contract controls are present and the removed no-op field stays absent.
for (const id of ['account-visibility', 'comment-privacy', 'show-activity-status', 'message-privacy', 'content-visibility', 'follow-requests-list']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.doesNotMatch(settings, /activity_visibility/);
for (const field of ['account_visibility', 'comment_privacy', 'show_activity_status', 'message_privacy', 'content_visibility']) assert.match(settings, new RegExp(`${field}:`));
assert.match(settings, /state\[key\] != null/); // server defaults are not overwritten with empty values
assert.match(settings, /follow-requests\/\$\{id\}\/approve/);
assert.match(settings, /follow-requests\/\$\{id\}\/reject/);
assert.match(settings, /profile_updated/);
assert.match(settings, /password_changed/);
assert.match(settings, /textValue\(row\.title \|\| row\.text/); // archive/activity strings are escaped
assert.match(settings, /origin !== window\.location\.origin/);
assert.match(settings, /media/);
assert.match(settings, /URL\.revokeObjectURL/);

// Private profiles must not request denied lists/content, and pending is a first-class state.
assert.match(profile, /isPrivateRestricted/);
assert.match(profile, /followStatus === "pending"/);
assert.match(profile, /current\.account_visibility === "private"/);
assert.match(profile, /current\.can_view_content === false/);
assert.match(profile, /هذه القائمة متاحة للمتابعين المقبولين فقط/);
assert.doesNotMatch(profile, /activity_visibility/);
console.log('test_privacy_frontend.cjs: privacy frontend contract passed');
