const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/screens/ReelsScreen.tsx'), 'utf8');

test('Reels feed renders video only in the active row', () => {
  assert.match(source, /active && source \? <ActiveVideo source=\{source\}/);
  assert.equal((source.match(/<ActiveVideo source=\{source\}/g) || []).length, 2);
  assert.match(source, /function ActiveVideo\(/);
  assert.match(source, /useVideoPlayer\(videoSource/);
  assert.match(source, /authenticatedMediaSource\(source, token\)/);
  assert.match(source, /uri: authenticated, useCaching: true/);
  assert.match(source, /\.\.\.authenticated, useCaching: false/);
  assert.match(source, /if \(playable\) setActiveId\(null\)/);
});

test('Reels feed is bounded and keyed for native list virtualization', () => {
  assert.match(source, /keyExtractor=\{\(item\) => item\.key\}/);
  assert.match(source, /initialNumToRender=\{2\}/);
  assert.match(source, /maxToRenderPerBatch=\{2\}/);
  assert.match(source, /windowSize=\{3\}/);
  assert.match(source, /removeClippedSubviews/);
  assert.match(source, /onEndReached=\{loadMore\}/);
  assert.match(source, /skip=\$\{reels\.length\}&limit=20/);
});

test('rows are memoized and playback is disabled when screen loses focus', () => {
  assert.match(source, /const PostReelItem = React\.memo/);
  assert.match(source, /const ReelItem = React\.memo/);
  assert.match(source, /active=\{isFocused && item\.reel\.id === activeId\}/);
  assert.match(source, /return \(\) => \{ setActiveId\(null\); setActivePostId\(null\); \}/);
});
