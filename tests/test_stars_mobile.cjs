#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.join(__dirname, '..', 'mobile', 'node_modules', 'typescript'));

const source = fs.readFileSync(path.join(__dirname, '..', 'mobile/src/components/StarsCard.tsx'), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/export default function StarsCard/, 'function StarsCard');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;

const levels = Array.from({ length: 10 }, (_, i) => ({ level: i + 1, name: i === 9 ? 'Black Crystal Star' : `المستوى ${i + 1}`, required_followers: i * 100, required_active_days: i * 2, color: '#abc', icon: '◆', earned: i < 2, proposed_priority_bonus_percent: i + 1 }));
const base = { level: 2, name: levels[1].name, followers_count: 100, active_days: 2, progress_percent: 50, next_level: 3, reward: { applied: false, proposed_priority_bonus_percent: 2, description: 'ignored' }, levels };

// A small React-like harness: hook slots are stable, effects are scheduled during
// render but only run after render, and memoized callbacks retain identity by deps.
function harness(api, { strictReplay = false } = {}) {
  const slots = []; let cursor = 0; let pendingEffects = []; let mounted = false; let focused = true; let tree;
  let focusCallback = null; let focusCleanup = null; let renderCount = 0; let mountedStateUpdates = 0;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const schedule = (slot, create, deps) => {
    const previous = slots[slot];
    if (!previous || !sameDeps(previous.deps, deps)) {
      slots[slot] = { deps, create, cleanup: previous && previous.cleanup };
      pendingEffects.push({ slot, create });
    }
  };
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children } }; },
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { if (!mounted) return; mountedStateUpdates++; slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(value) { const i = cursor++; if (!slots[i]) slots[i] = { current: value }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { deps, value: fn }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; schedule(i, fn, deps); },
  };
  const context = { React, useState: React.useState, useRef: React.useRef, useCallback: React.useCallback, useEffect: React.useEffect, apiRequest: api, ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', StyleSheet: { create: x => x }, Text: 'Text', View: 'View', colors: { primary: '#0af', primaryDark: '#05a', ink: '#111', muted: '#666', soft: '#eee', border: '#ddd' }, pagePadding: 8, useFocusEffect(callback) {
    const i = cursor++; const changed = !focusCallback || focusCallback !== callback;
    focusCallback = callback;
    if (focused && changed) pendingEffects.push({ slot: `focus:${i}`, create: () => { if (focusCleanup) focusCleanup(); focusCleanup = callback(); return null; } });
  }, console };
  context.require = () => ({}); context.exports = {}; context.module = { exports: context.exports };
  vm.runInNewContext(`${compiled}\nmodule.exports = { StarsCard };`, context);
  const Card = context.module.exports.StarsCard;
  function render(props) { cursor = 0; tree = Card(props); renderCount++; mounted = true; return tree; }
  function flushEffects() {
    const queue = pendingEffects.splice(0);
    for (const effect of queue) {
      if (typeof effect.slot === 'number' && slots[effect.slot].cleanup) slots[effect.slot].cleanup();
      const cleanup = effect.create();
      if (typeof effect.slot === 'number') slots[effect.slot].cleanup = cleanup;
      if (strictReplay && renderCount === 1 && typeof effect.slot === 'number') {
        if (cleanup) cleanup();
        const replayCleanup = effect.create();
        slots[effect.slot].cleanup = replayCleanup;
      }
    }
  }
  function blur() { if (!focused) return; focused = false; if (focusCleanup) { focusCleanup(); focusCleanup = null; } }
  function focus() { focused = true; if (focusCallback) { pendingEffects.push({ slot: 'focus:manual', create: () => { if (focusCleanup) focusCleanup(); focusCleanup = focusCallback(); } }); } }
  function unmount() { mounted = false; blur(); for (const slot of slots) if (slot && slot.cleanup) { slot.cleanup(); slot.cleanup = null; } }
  return { render, flushEffects, blur, focus, unmount, get tree() { return tree; }, get states() { return slots.map(x => x && x.value); }, get mountedStateUpdates() { return mountedStateUpdates; } };
}
function text(tree) { if (tree == null) return ''; if (Array.isArray(tree)) return tree.map(text).join(''); if (typeof tree === 'string' || typeof tree === 'number') return String(tree); return text(tree.props && tree.props.children); }
function all(tree, type) { const out = []; (function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; if (n.type === type) out.push(n); const c = n.props && n.props.children; (Array.isArray(c) ? c : [c]).forEach(walk); })(tree); return out; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { await tick(); await tick(); };

(async () => {
  const pending = []; const api = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const h = harness(api);
  h.render({ username: 'a', token: 't' }); h.flushEffects();
  assert.equal(pending.length, 1, 'focus effect starts one request after render');
  pending.shift().resolve(base); await settle();
  let tree = h.render({ username: 'a', token: 't' });
  assert.match(text(tree), /المستوى الفعلي: 2/); assert.match(text(tree), /الحالي: ١٠٠ متابع/);
  const buttons = all(tree, 'Pressable'); assert.equal(buttons.length, 10); assert.equal(buttons[9].props.accessibilityState.selected, false);
  buttons[9].props.onPress(); tree = h.render({ username: 'a', token: 't' });
  assert.equal(h.states[1], 10); assert.equal(all(tree, 'Pressable')[9].props.accessibilityState.selected, true);
  assert.match(text(tree), /الحالي: ١٠٠ متابع/); assert.match(text(tree), /أولوية مقترحة لهذا المستوى: \+١٠%|\+10%/);

  // Refocus refresh failure must clear previously cached private metrics.
  h.blur(); h.focus(); h.flushEffects(); assert.equal(pending.length, 1); pending.shift().reject(new Error('404')); await settle();
  tree = h.render({ username: 'a', token: 't' }); assert.match(text(tree), /تعذر تحميل النجوم|لا يمكن عرض نجوم/); assert.doesNotMatch(text(tree), /المستوى الفعلي/);

  // Switching identity before old effects flush cannot display the old tree.
  const switchPending = []; const sw = harness(() => new Promise((resolve, reject) => switchPending.push({ resolve, reject })));
  sw.render({ username: 'old', token: 'one' }); sw.render({ username: 'new', token: 'two' });
  assert.equal(text(sw.tree), '', 'identity switch hides stale data before effects run'); sw.flushEffects(); assert.equal(switchPending.length, 2);
  switchPending[0].resolve(base); switchPending[1].resolve({ ...base, name: 'الجديد', levels: levels.map(x => ({ ...x, name: x.level === 2 ? 'الجديد' : x.name })) }); await settle();
  assert.equal(sw.render({ username: 'new', token: 'two' }) && sw.states[0].name, 'الجديد');

  // Stale race, missing token, strict replay, zero and max values, and unmount safety.
  const racePending = []; const race = harness(() => new Promise((resolve, reject) => racePending.push({ resolve, reject })));
  race.render({ username: 'old', token: 'one' }); race.flushEffects(); race.render({ username: 'new', token: 'two' }); race.flushEffects();
  assert.equal(racePending.length, 2); racePending[0].resolve(base); racePending[1].resolve({ ...base, name: 'الجديد' }); await settle(); assert.equal(race.states[0].name, 'الجديد');
  const noToken = harness(api); assert.equal(noToken.render({ username: 'x', token: null }), null); noToken.flushEffects();
  const strict = harness(() => Promise.resolve({ ...base, followers_count: 0, active_days: 0, progress_percent: 100, next_level: null }), { strictReplay: true });
  strict.render({ username: 'max', token: 't' }); strict.flushEffects(); await settle(); tree = strict.render({ username: 'max', token: 't' }); assert.match(text(tree), /٠ متابع/); assert.match(text(tree), /وصلت إلى أعلى مستوى/);
  const before = strict.mountedStateUpdates; strict.unmount(); assert.equal(strict.mountedStateUpdates, before, 'unmount prevents late state updates');
  console.log('test_stars_mobile.cjs: hook slots/effect timing, memo deps, focus refresh, selection, identity/race guards, no-token, strict replay, zero/max, and unmount passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
