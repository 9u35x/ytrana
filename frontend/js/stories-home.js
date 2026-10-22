// قصص الصفحة الرئيسية: فقاعات سريعة مع دعم النص والصورة والفيديو.
(() => {
  const rows = new Map();
  let activeStory = null;
  const mediaUrl = (raw) => {
    if (!raw) return null;
    try {
      const api = new URL(YTRANA_CONFIG.API_BASE, window.location.href);
      const url = new URL(raw, api);
      return url.origin === api.origin && url.pathname.startsWith('/uploads/') ? url.href : null;
    } catch (_) { return null; }
  };
  const show = (id) => document.getElementById(id)?.classList.add('show');
  const hide = (id) => document.getElementById(id)?.classList.remove('show');
  function renderStory(story) {
    rows.set(String(story.id), story);
    const image = mediaUrl(story.image_url), video = mediaUrl(story.video_url);
    const label = story.author?.full_name || 'قصة';
    return `<button type="button" class="home-story" data-story-id="${escapeHtml(story.id)}">
      <span class="home-story-ring">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : video ? '▶' : '✦'}</span>
      <span>${escapeHtml(label.split(' ')[0])}</span>
    </button>`;
  }
  async function load() {
    const bar = document.getElementById('stories-bar'); if (!bar) return;
    try {
      const stories = await Api.get('/api/stories/feed');
      rows.clear();
      const me = Auth.getCurrentUser();
      bar.innerHTML = `<button type="button" class="home-story home-story-add" id="home-story-add"><span class="home-story-ring">＋</span><span>قصتي</span></button>` + stories.map(renderStory).join('');
      document.getElementById('home-story-add').onclick = () => show('home-story-modal');
      bar.querySelectorAll('[data-story-id]').forEach((b) => { b.onclick = () => open(rows.get(String(b.dataset.storyId))); });
    } catch (err) { bar.innerHTML = '<button type="button" class="home-story home-story-add" id="home-story-add"><span class="home-story-ring">＋</span><span>قصتي</span></button>'; document.getElementById('home-story-add').onclick = () => show('home-story-modal'); }
  }
  function open(story) {
    if (!story) return;
    activeStory = story;
    const content = document.getElementById('home-story-content');
    const image = mediaUrl(story.image_url), video = mediaUrl(story.video_url);
    content.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="صورة القصة">` : video ? `<video src="${escapeHtml(video)}" autoplay playsinline aria-label="فيديو القصة"></video>` : `<div class="story-text-card">${escapeHtml(story.caption || '')}</div>`;
    const player = content.querySelector('video');
    if (player) { player.addEventListener('click', () => { if (player.paused) player.play(); else player.pause(); }); player.play().catch(() => {}); }
    document.getElementById('home-story-caption').textContent = story.caption || '';
    let reportButton = document.getElementById('home-story-report');
    if (!reportButton) { reportButton = document.createElement('button'); reportButton.id = 'home-story-report'; reportButton.type = 'button'; reportButton.className = 'btn btn-outline btn-sm'; reportButton.textContent = 'إبلاغ'; document.getElementById('home-story-close')?.parentNode?.appendChild(reportButton); }
    reportButton.hidden = story.author?.id === Auth.getCurrentUser()?.id;
    reportButton.onclick = () => openReportModal('story', story.id);
    const replyForm = document.getElementById('home-story-reply-form');
    if (replyForm) { replyForm.hidden = story.author?.id === Auth.getCurrentUser()?.id; document.getElementById('home-story-reply').value = ''; }
    show('home-story-viewer');
    if (!story.viewed_by_me && story.author?.id !== Auth.getCurrentUser()?.id) Api.post(`/api/stories/${story.id}/view`).catch(() => {});
  }
  function init() {
    document.getElementById('home-story-close')?.addEventListener('click', () => { activeStory = null; document.getElementById('home-story-content').innerHTML = ''; hide('home-story-viewer'); });
    document.getElementById('home-story-reply-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('home-story-reply');
      const text = input.value.trim();
      if (!text || !activeStory) return;
      const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const caption = (activeStory.caption || '').trim().slice(0, 120);
        const quote = caption ? `: «${caption}${activeStory.caption.length > 120 ? '…' : ''}»` : '';
        await Api.post(`/api/messages/${encodeURIComponent(activeStory.author.username)}`, { content: `رد على قصتك${quote}\n${text}` });
        input.value = '';
        showToast('تم إرسال ردك إلى صاحب القصة', 'success');
      } catch (err) { showToast(err.message || 'تعذر إرسال الرد', 'error'); }
      finally { button.disabled = false; }
    });
    document.getElementById('home-story-modal-close')?.addEventListener('click', () => hide('home-story-modal'));
    document.getElementById('home-story-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0]; const label = document.getElementById('home-story-file-label');
      if (label) label.textContent = file ? file.name : 'اختر صورة أو فيديو';
    });
    document.getElementById('home-story-form')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const form = e.currentTarget; const caption = form.caption.value.trim(); const file = form.file.files[0];
      if (!caption && !file) return showToast('أضف نصًا أو صورة أو فيديو للقصة', 'error');
      if (file && file.size > 20 * 1024 * 1024) return showToast('حجم الملف يتجاوز 20MB', 'error');
      const data = new FormData(); data.append('caption', caption); if (file) data.append(file.type.startsWith('video/') ? 'video' : 'image', file); data.append('mood_key', form.mood_key.value || '');
      const button = form.querySelector('button[type=submit]'); button.disabled = true;
      try { await Api.post('/api/stories', data, true); form.reset(); hide('home-story-modal'); showToast('نُشرت القصة، وستختفي بعد 24 ساعة', 'success'); load(); } catch (err) { showToast(err.message, 'error'); } finally { button.disabled = false; }
    });
    load();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
