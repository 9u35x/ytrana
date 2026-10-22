// صفحة الوسائط المشتركة: قصص 24 ساعة ومقاطع Reels قصيرة.
Layout.init("media");

const MediaPage = (() => {
  const storyRows = new Map();
  const reelRows = new Map();
  let activeStory = null;
  let activeObserver = null;

  function mediaUrl(raw) {
    if (typeof raw !== "string" || !raw) return null;
    try {
      const api = new URL(YTRANA_CONFIG.API_BASE, window.location.href);
      const url = new URL(raw, api);
      return url.origin === api.origin && url.pathname.startsWith("/uploads/") ? url.href : null;
    } catch (_) { return null; }
  }
  async function secureMediaUrl(raw) {
    const publicUrl = mediaUrl(raw);
    if (publicUrl) return publicUrl;
    if (typeof raw !== "string" || !raw || !Api.getToken()) return null;
    try {
      const api = new URL(YTRANA_CONFIG.API_BASE, window.location.href);
      const url = new URL(raw, api);
      if (url.origin !== api.origin || (!url.pathname.startsWith("/api/private-media/") && !url.pathname.startsWith("/api/account/archive/"))) return null;
      const response = await fetch(url.href, { headers: { Authorization: `Bearer ${Api.getToken()}` } });
      if (!response.ok) return null;
      return URL.createObjectURL(await response.blob());
    } catch (_) { return null; }
  }

  function showError(id, message) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message || "تعذر إكمال العملية.";
    element.classList.add("show");
  }
  function clearError(id) {
    const element = document.getElementById(id);
    if (element) { element.textContent = ""; element.classList.remove("show"); }
  }

  function switchTab(tab) {
    document.querySelectorAll("[data-media-tab]").forEach((button) => {
      const active = button.dataset.mediaTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.getElementById("stories-panel").hidden = tab !== "stories";
    document.getElementById("reels-panel").hidden = tab !== "reels";
    return tab === "reels" ? loadReels() : loadStories();
  }

  function initTabs() {
    document.querySelectorAll("[data-media-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.mediaTab));
    });
  }

  async function loadStories() {
    const list = document.getElementById("stories-list");
    list.innerHTML = '<div class="card media-empty">جارٍ تحميل القصص…</div>';
    try {
      const rows = await Api.get("/api/stories/feed");
      storyRows.clear();
      rows.forEach((story) => storyRows.set(String(story.id), story));
      if (!rows.length) {
        list.innerHTML = '<div class="card media-empty">لا توجد قصص الآن. شارك قصتك أو تابع أصدقاءك.</div>';
        return;
      }
      const hydrated = await Promise.all(rows.map(async (story) => ({ story, image: await secureMediaUrl(story.image_url), video: await secureMediaUrl(story.video_url) })));
      list.innerHTML = hydrated.map(({ story, image, video }) => {
        const expires = new Date(story.expires_at).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
        return `<article class="card story-row">
          <button class="story-open" type="button" data-story-id="${escapeHtml(story.id)}" aria-label="عرض قصة ${escapeHtml(story.author.username)}">
            ${renderAvatar(story.author, "avatar-md")}
            <span class="story-info"><strong>${escapeHtml(story.author.full_name)}</strong><span>${escapeHtml(story.caption || "شارك صورة جديدة")}</span><small>مشاهدات ${escapeHtml(story.views_count)} · تنتهي ${escapeHtml(expires)}</small></span>
            ${image ? `<img class="story-thumb" src="${escapeHtml(image)}" alt="صورة القصة" loading="lazy">` : video ? "▶" : ""}${story.mood_key ? `<em class="media-mood">${story.mood_key === "happy" ? "😊 سعيد" : "😔 حزين"}</em>` : ""}
          </button>
          ${story.author.username === Auth.getCurrentUser()?.username ? `<div class="story-owner-actions"><button type="button" class="btn btn-outline btn-sm story-archive" data-story-id="${escapeHtml(story.id)}">أرشفة</button><button type="button" class="btn btn-danger btn-sm story-delete" data-story-id="${escapeHtml(story.id)}">حذف</button></div>` : ""}
        </article>`;
      }).join("");
    } catch (error) { list.innerHTML = `<div class="card media-empty">${escapeHtml(error.message)}</div>`; }
  }

  function openStory(id) {
    const story = storyRows.get(String(id));
    if (!story) return;
    activeStory = story;
    const dialog = document.getElementById("story-viewer");
    const content = document.getElementById("viewer-content");
    document.getElementById("viewer-author").innerHTML = `${renderAvatar(story.author, "avatar-sm")} <strong>${escapeHtml(story.author.full_name)} · @${escapeHtml(story.author.username)}</strong>`;
    document.getElementById("viewer-caption").textContent = story.caption || "";
    document.getElementById("viewer-delete").hidden = story.author.username !== Auth.getCurrentUser()?.username;
    document.getElementById("viewer-delete").dataset.storyId = String(story.id);
    let reportButton = document.getElementById("viewer-report");
    if (!reportButton) { reportButton = document.createElement("button"); reportButton.id = "viewer-report"; reportButton.type = "button"; reportButton.className = "btn btn-outline btn-sm"; reportButton.textContent = "إبلاغ"; document.getElementById("viewer-delete").parentNode.appendChild(reportButton); }
    reportButton.hidden = story.author.username === Auth.getCurrentUser()?.username;
    reportButton.onclick = () => openReportModal("story", story.id);
    const replyForm = document.getElementById("viewer-reply-form");
    if (replyForm) { replyForm.hidden = story.author.username === Auth.getCurrentUser()?.username; document.getElementById("viewer-reply").value = ""; }
    const image = mediaUrl(story.image_url);
    const video = mediaUrl(story.video_url);
    content.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="صورة القصة">` : video ? `<video src="${escapeHtml(video)}" autoplay playsinline aria-label="فيديو القصة"></video>` : `<div class="story-text-card">${escapeHtml(story.caption || "")}</div>`;
    const player = content.querySelector("video");
    if (player) { player.addEventListener("click", () => { if (player.paused) player.play(); else player.pause(); }); player.play().catch(() => {}); }
    if (typeof dialog.showModal === "function") dialog.showModal();
    if (!story.viewed_by_me && story.author.username !== Auth.getCurrentUser()?.username) {
      Api.post(`/api/stories/${story.id}/view`).then((result) => {
        story.viewed_by_me = true; story.views_count = result.views_count;
        loadStories();
      }).catch(() => {});
    }
  }

  function initStoryForm() {
    document.getElementById("story-form").addEventListener("submit", async (event) => {
      event.preventDefault(); clearError("story-error");
      const form = event.currentTarget;
      const caption = document.getElementById("story-caption").value.trim();
      const file = document.getElementById("story-image").files[0];
      if (!caption && !file) return showError("story-error", "أضف نصًا أو صورة للقصة.");
      if (file && file.size > 20 * 1024 * 1024) return showError("story-error", "حجم ملف القصة يتجاوز 20MB.");
      const button = document.getElementById("story-submit"); button.disabled = true;
      try {
        const data = new FormData(); data.append("caption", caption); if (file) data.append(file.type.startsWith("video/") ? "video" : "image", file); data.append("mood_key", form.querySelector("input[name=\"mood_key\"]:checked")?.value || "");
        await Api.post("/api/stories", data, true);
        form.reset(); showToast("نُشرت القصة، وستختفي بعد 24 ساعة.", "success"); await loadStories();
      } catch (error) { showError("story-error", error.message); }
      finally { button.disabled = false; }
    });
    document.getElementById("stories-list").addEventListener("click", async (event) => {
      const openButton = event.target.closest(".story-open");
      if (openButton) return openStory(openButton.dataset.storyId);
      const archiveButton = event.target.closest(".story-archive");
      if (archiveButton) {
        if (!window.confirm("ستختفي القصة من الخلاصات دون حذفها. متابعة؟")) return;
        try { await Api.post(`/api/account/archive/stories/${encodeURIComponent(archiveButton.dataset.storyId)}`); showToast("تمت أرشفة القصة.", "success"); await loadStories(); }
        catch (error) { showToast(error.message, "error"); }
        return;
      }
      const deleteButton = event.target.closest(".story-delete");
      if (!deleteButton || !window.confirm("هل تريد حذف هذه القصة؟")) return;
      try { await Api.del(`/api/stories/${deleteButton.dataset.storyId}`); showToast("تم حذف القصة.", "success"); await loadStories(); }
      catch (error) { showToast(error.message, "error"); }
    });
    document.getElementById("viewer-close").addEventListener("click", () => document.getElementById("story-viewer").close());
    document.getElementById("story-viewer").addEventListener("close", () => { activeStory = null; document.getElementById("viewer-content").innerHTML = ""; });
    document.getElementById("viewer-reply-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("viewer-reply"), text = input.value.trim();
      if (!text || !activeStory) return;
      const form = event.currentTarget, button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try {
        const caption = (activeStory.caption || "").trim().slice(0, 120);
        const quote = caption ? `: «${caption}${activeStory.caption.length > 120 ? "…" : ""}»` : "";
        await Api.post(`/api/messages/${encodeURIComponent(activeStory.author.username)}`, { content: `رد على قصتك${quote}\n${text}` });
        input.value = ""; showToast("تم إرسال ردك إلى صاحب القصة", "success");
      } catch (error) { showToast(error.message || "تعذر إرسال الرد", "error"); }
      finally { button.disabled = false; }
    });
    document.getElementById("viewer-delete").addEventListener("click", async (event) => {
      const id = event.currentTarget.dataset.storyId;
      try { await Api.del(`/api/stories/${id}`); document.getElementById("story-viewer").close(); showToast("تم حذف القصة.", "success"); await loadStories(); }
      catch (error) { showToast(error.message, "error"); }
    });
    document.getElementById("stories-refresh").addEventListener("click", loadStories);
  }

  async function loadReels() {
    const list = document.getElementById("reels-list");
    if (activeObserver) activeObserver.disconnect();
    list.innerHTML = '<div class="card media-empty">جارٍ تحميل الريلز…</div>';
    try {
      const rows = await Api.get("/api/reels/feed?skip=0&limit=20");
      reelRows.clear(); rows.forEach((reel) => reelRows.set(String(reel.id), reel));
      if (!rows.length) { list.innerHTML = '<div class="card media-empty">لا توجد مقاطع بعد؛ ارفع أول ريل.</div>'; return; }
      list.innerHTML = rows.map((reel) => {
        const src = mediaUrl(reel.video_url);
        if (!src) return "";
        const mine = reel.author.username === Auth.getCurrentUser()?.username;
        return `<article class="reel-card" data-reel-id="${escapeHtml(reel.id)}">
          <video src="${escapeHtml(src)}" controls muted loop playsinline preload="metadata" aria-label="ريل ${escapeHtml(reel.author.username)}"></video>
          <div class="reel-meta">${renderAvatar(reel.author, "avatar-sm")}<div class="reel-by"><strong>@${escapeHtml(reel.author.username)}</strong><span>${escapeHtml(reel.caption || "مقطع جديد")}</span>${reel.mood_key ? `<small class="media-mood">${reel.mood_key === "happy" ? "😊 سعيد" : "😔 حزين"}</small>` : ""}</div></div>
          <div class="reel-actions">
            <button type="button" class="post-action-btn reel-like ${reel.liked_by_me ? "liked" : ""}" data-reel-like="${escapeHtml(reel.id)}" aria-label="إعجاب">♥ <span>${escapeHtml(reel.likes_count)}</span></button>
            <span class="reel-views">مشاهدة ${escapeHtml(reel.views_count)}</span>
            ${!mine ? `<button type="button" class="btn btn-outline btn-sm reel-report" data-reel-report="${escapeHtml(reel.id)}">إبلاغ</button>` : ""}${mine ? `<button type="button" class="btn btn-danger btn-sm reel-delete" data-reel-delete="${escapeHtml(reel.id)}">حذف</button>` : ""}
          </div>
        </article>`;
      }).join("");
      initReelObserver(list);
    } catch (error) { list.innerHTML = `<div class="card media-empty">${escapeHtml(error.message)}</div>`; }
  }

  function initReelObserver(list) {
    if (!("IntersectionObserver" in window)) return;
    activeObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      const video = entry.target.querySelector("video");
      if (entry.isIntersecting) {
        video.play().catch(() => {});
        const id = entry.target.dataset.reelId;
        const reel = reelRows.get(String(id));
        if (reel && !reel.viewed_by_me) {
          reel.viewed_by_me = true;
          Api.post(`/api/reels/${id}/view`).then((result) => { reel.views_count = result.views_count; }).catch(() => { reel.viewed_by_me = false; });
        }
      } else video.pause();
    }), { threshold: 0.65 });
    list.querySelectorAll(".reel-card").forEach((card) => activeObserver.observe(card));
  }

  function initReelForm() {
    document.getElementById("reel-form").addEventListener("submit", async (event) => {
      event.preventDefault(); clearError("reel-error");
      const form = event.currentTarget;
      const file = document.getElementById("reel-video").files[0];
      if (!file) return showError("reel-error", "اختر مقطع فيديو أولًا.");
      if (file.size > 20 * 1024 * 1024) return showError("reel-error", "حجم الفيديو يتجاوز 20MB.");
      const button = document.getElementById("reel-submit"); button.disabled = true;
      try {
        const duration = await new Promise((resolve, reject) => {
          const url = URL.createObjectURL(file); const probe = document.createElement("video");
          probe.preload = "metadata"; probe.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(probe.duration); };
          probe.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذر قراءة ملف الفيديو.")); };
          probe.src = url;
        });
        if (!Number.isFinite(duration) || duration > 60) throw new Error("الحد الأقصى لطول الريل هو 60 ثانية.");
        const data = new FormData(form);
        await Api.post("/api/reels", data, true);
        form.reset(); showToast("تم رفع الريل.", "success"); await loadReels();
      } catch (error) { showError("reel-error", error.message); }
      finally { button.disabled = false; }
    });
    document.getElementById("reels-list").addEventListener("click", async (event) => {
      const like = event.target.closest("[data-reel-like]");
      if (like) {
        const id = like.dataset.reelLike; const reel = reelRows.get(String(id)); if (!reel) return;
        const next = !reel.liked_by_me; reel.liked_by_me = next; reel.likes_count += next ? 1 : -1;
        like.classList.toggle("liked", next); like.querySelector("span").textContent = String(reel.likes_count);
        try { if (next) await Api.post(`/api/reels/${id}/like`); else await Api.del(`/api/reels/${id}/like`); }
        catch (error) { reel.liked_by_me = !next; reel.likes_count += next ? -1 : 1; like.classList.toggle("liked", reel.liked_by_me); like.querySelector("span").textContent = String(reel.likes_count); showToast(error.message, "error"); }
      }
      const report = event.target.closest("[data-reel-report]");
      if (report) { openReportModal("reel", report.dataset.reelReport); return; }
      const remove = event.target.closest("[data-reel-delete]");
      if (remove && window.confirm("هل تريد حذف هذا الريل؟")) {
        try { await Api.del(`/api/reels/${remove.dataset.reelDelete}`); showToast("تم حذف الريل.", "success"); await loadReels(); }
        catch (error) { showToast(error.message, "error"); }
      }
    });
    document.getElementById("reels-refresh").addEventListener("click", loadReels);
  }

  function init() {
    initTabs(); initStoryForm(); initReelForm();
    const params = new URLSearchParams(window.location.search);
    const postId = params.get("post_id");
    const tab = params.get("tab") === "reels" || postId ? "reels" : "stories";
    switchTab(tab).then(() => { if (postId) return loadPostReel(postId); });
  }
  async function loadPostReel(postId) {
    try {
      const post = await Api.get(`/api/media/posts/${encodeURIComponent(postId)}`);
      const src = mediaUrl(post.video_url); if (!src) return;
      const card = document.createElement("article"); card.className = "reel-card reel-from-post";
      card.innerHTML = `<video src="${escapeHtml(src)}" controls autoplay muted playsinline></video><div class="reel-meta">${renderAvatar(post.author, "avatar-sm")}<div class="reel-by"><strong>@${escapeHtml(post.author.username)}</strong><span>${escapeHtml(post.content || "فيديو من المنشورات")}</span>${post.mood_key ? `<small class="media-mood">${post.mood_key === "happy" ? "😊 سعيد" : "😔 حزين"}</small>` : ""}</div></div>`;
      const list = document.getElementById("reels-list"); if (list) list.prepend(card);
    } catch (_) { /* يبقى تحميل الريلز المعتاد ظاهرًا */ }
  }

  return { init };
})();
MediaPage.init();
