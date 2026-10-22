const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../mobile/src/screens/AccountSettingsScreen.tsx'), 'utf8');
assert.match(source, /type ActivityItem = \{[^\n]*type: string[^\n]*text\?: string/);
assert.match(source, /labels\[item\.type\]/);
assert.match(source, /x\.text\|\|'محتوى وسائط'/);
for (const event of ['settings_updated', 'profile_updated', 'password_changed', 'archived', 'restored', 'comment', 'like']) {
  assert.ok(source.includes(`${event}:`), `Missing activity event label: ${event}`);
}
assert.match(source, /include_active=true/);
assert.match(source, /method:'PATCH'/);
assert.doesNotMatch(source, /activity_visibility/);
assert.ok(source.includes('الحساب الخاص يعرض معاينة عامة فقط'));
assert.ok(source.includes('account_visibility'));
assert.ok(source.includes('comment_privacy'));
assert.ok(source.includes('show_activity_status'));
console.log('MOBILE_ACCOUNT_CONTRACT_OK: canonical API fields, event labels, scoped privacy, archive actions');
