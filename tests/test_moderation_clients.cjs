/* اختبارات محلية فقط، بلا شبكة أو قاعدة بيانات أو متصفح مسجل الدخول. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'mobile/node_modules/typescript'));

const adminContext = vm.createContext({ window: { addEventListener() {} }, URL, console });
vm.runInContext(fs.readFileSync(path.join(root, 'frontend/js/admin.js'), 'utf8'), adminContext);
assert.equal(vm.runInContext('qs({status_filter:"all",target_type:"",skip:0,limit:12})', adminContext), 'skip=0&limit=12');
assert.equal(vm.runInContext('REPORT_TYPES.includes("account")', adminContext), false);
assert.equal(vm.runInContext('REPORT_TYPES.includes("reel") && REPORT_TYPES.includes("message")', adminContext), true);
assert.equal(vm.runInContext('adminEsc("<script>hi</script>")', adminContext), '&lt;script&gt;hi&lt;/script&gt;');
assert.equal(vm.runInContext('isClosedReport({status:"reviewed"})', adminContext), true);

const calls = [];
const apiContext = vm.createContext({ exports: {}, require(name) {
  assert.equal(name, './api');
  return { apiRequest(url, options) { calls.push({url, options}); return Promise.resolve([]); } };
} });
const apiSource = fs.readFileSync(path.join(root, 'mobile/src/adminApi.ts'), 'utf8');
vm.runInContext(ts.transpileModule(apiSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, apiContext);
apiContext.exports.loadAdminReports('fixture-token', 'dismissed', 'comment', 20, 20);
assert.equal(calls.at(-1).url, '/api/admin/reports?status_filter=dismissed&target_type=comment&skip=20&limit=20');
assert.equal(calls.at(-1).options.token, 'fixture-token');
assert(!calls.at(-1).url.includes('fixture-token'));
apiContext.exports.submitReport('fixture-token', 'user', 4, 'privacy', '');
assert.equal(calls.at(-1).options.body.reason, 'انتهاك الخصوصية');
apiContext.exports.unfreezeUser('fixture-token', 4, 'reviewed');
assert.equal(calls.at(-1).options.body.note, 'reviewed');

const screen = fs.readFileSync(path.join(root, 'mobile/src/screens/AdminScreen.tsx'), 'utf8');
const parseSource = screen.slice(screen.indexOf('function parseDays('), screen.indexOf('function date('));
const daysContext = vm.createContext({});
vm.runInContext(ts.transpileModule(parseSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, daysContext);
for (const value of ['0', '-1', '1.5', 'word', '3651', 'NaN']) {
  assert.throws(() => vm.runInContext(`parseDays(${JSON.stringify(value)})`, daysContext));
}
assert.equal(vm.runInContext('parseDays("")', daysContext), undefined);
assert.equal(vm.runInContext('parseDays("7", true)', daysContext), 7);
assert.throws(() => vm.runInContext('parseDays("", true)', daysContext));
assert(screen.includes("Alert.alert('تأكيد الإجراء'"));
for (const name of ['media.html', 'messages.html']) {
  assert(fs.readFileSync(path.join(root, 'frontend', name), 'utf8').includes('js/post-card.js'), `${name} must load the shared report form`);
}
assert(fs.readFileSync(path.join(root, 'frontend/js/post-card.js'), 'utf8').includes('document.querySelector("dialog[open]")'), 'report form must be inside an open story dialog');
console.log('CLIENT_CONTRACTS_OK: filters, escaping, report types, API payloads, day validation, confirmations, and form dependencies');
