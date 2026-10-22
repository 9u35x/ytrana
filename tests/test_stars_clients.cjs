#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/js/stars.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/profile.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/css/stars.css'), 'utf8');
assert.match(html, /css\/stars\.css/); assert.match(html, /js\/stars\.js/); assert.match(html, /profile-stars/);
assert.doesNotMatch(source, /\+50%|\+50/); assert.match(source, /غير مطبقة/); assert.match(css, /@media/);
function setup(api) { const context = { Api: api, encodeURIComponent, console, setTimeout }; context.window = context; context.document = { getElementById: () => null }; vm.runInNewContext(source, context); return context; }
function node() { return { innerHTML: '', querySelector(selector) { return selector === '.stars-retry' ? this.retry : null; } }; }
const levels = Array.from({ length: 10 }, (_, i) => ({ level: i + 1, name: i === 9 ? 'ذروة' : `مستوى ${i + 1}`, required_followers: i * 5000000, required_active_days: i * 40, color: '#fff', icon: i === 9 ? '◆' : '★', earned: i === 0, proposed_priority_bonus_percent: (i + 1) * 5 }));
const data = { level: 1, name: 'أساس', followers_count: 0, active_days: 0, progress_percent: 0, next_level: 2, reward: { applied: false }, levels };
{
  const context = setup({ get: async () => data }); const markup = context.renderStarsCard(data);
  assert.match(markup, /&lt;|مستوى 1/); assert.match(markup, /مقفل/); assert.match(markup, /◆/); assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /المستوى الحالي الفعلي/); assert.match(markup, /أولوية توصية مقترحة للمستوى 1: 5%/); assert.match(markup, /غير مطبقة/);
  assert.doesNotMatch(markup, /style="--star-color:[^#]/);
}
{
  const context = setup({ get: async () => data }); const max = { ...data, level: 10, name: 'ذروة', followers_count: 50000000, active_days: 360, progress_percent: 100, next_level: null, levels: levels.map((x) => ({ ...x, earned: true })) };
  const markup = context.renderStarsCard(max); assert.match(markup, /50,000,000|٥٠٬٠٠٠٬٠٠٠/); assert.match(markup, /أعلى مستوى/); assert.match(markup, /aria-valuenow="100"/); assert.match(markup, /أولوية توصية مقترحة للمستوى 10: 50%/);
}
(async () => {
  const context = setup({ get: async () => { throw new Error('403'); } }); const target = node(); await context.loadStars('private<user>', target); assert.match(target.innerHTML, /تعذر تحميل مستويات النجوم/);
  target.retry = { addEventListener(type, fn) { assert.equal(type, 'click'); this.fn = fn; } }; await context.loadStars('private<user>', target); assert.match(target.innerHTML, /تعذر تحميل مستويات النجوم/);
  let calls = 0; const race = setup({ get: async () => { calls++; if (calls === 1) { await new Promise(r => setTimeout(r, 10)); return data; } return { ...data, level: 10, next_level: null, progress_percent: 100 }; } }); const first = node(), second = node();
  const a = race.loadStars('a', first), b = race.loadStars('b', second); await Promise.all([a, b]); assert.match(first.innerHTML, /aria-valuenow="0"/); assert.match(second.innerHTML, /aria-valuenow="100"/);
  // Mock DOM verifies button clicks change the preview only, never the actual-level heading.
  const card = { querySelectorAll() { return this.buttons; }, querySelector(selector) { return selector === ".stars-reward" ? this.reward : this.detail; }, reward: { innerHTML: "" }, buttons: [], detail: { innerHTML: '', }, };
  const buttons = [1, 10].map((n) => ({ attrs: { 'data-level': String(n) }, classList: { toggle() {} }, listeners: {}, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { this.listeners[k] = fn; } })); card.buttons = buttons; race.bindStarsCard(card, data); buttons[1].listeners.click(); assert.match(card.detail.innerHTML, /ذروة/); assert.equal(buttons[1].attrs['aria-pressed'], 'true'); assert.match(card.reward.innerHTML, /10: 50%/);
  const lexical = { apiImpl: { get: async () => data }, encodeURIComponent, console };
  lexical.window = lexical; lexical.document = { getElementById: () => null };
  vm.createContext(lexical);
  vm.runInContext('const Api = apiImpl;', lexical);
  assert.equal(lexical.Api, undefined, 'Top-level const Api is deliberately not a window property');
  vm.runInContext(source, lexical);
  const lexicalTarget = node(); await lexical.loadStars('creator', lexicalTarget);
  assert.match(lexicalTarget.innerHTML, /stars-level-button/);
  console.log('test_stars_clients.cjs: interactive level preview, actual-level stability, escaping, counts, failure, and race protection passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
