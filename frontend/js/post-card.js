// عناصر ووظائف بطاقة المنشور المشتركة بين الصفحة الرئيسية والملف الشخصي
function postMediaUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return null;
  try {
    const apiBase = new URL(YTRANA_CONFIG.API_BASE, window.location.href);
    const media = new URL(rawUrl, apiBase);
    if (media.origin !== apiBase.origin || !(media.pathname.startsWith("/uploads/") || media.pathname.startsWith("/api/private-media/"))) return null;
    return media.href;
  } catch (_error) {
    return null;
  }
}

async function enrichPostMedia(posts) {
  if (!posts || !posts.length) return posts || [];
  try {
    const ids = posts.map((post) => post.id).join(",");
    const media = await Api.get(`/api/media/posts?ids=${encodeURIComponent(ids)}`);
    const byId = new Map((media || []).map((post) => [post.id, post]));
    return posts.map((post) => ({ ...post, ...(byId.get(post.id) || {}) }));
  } catch (_error) {
    return posts;
  }
}

function renderPostCard(post) {
  const me = Auth.getCurrentUser();
  const isOwner = me && me.id === post.author.id;
  const imageSrc = postMediaUrl(post.image_url);
  const videoSrc = postMediaUrl(post.video_url);
  const secureImage = Boolean(imageSrc && new URL(imageSrc).pathname.startsWith("/api/private-media/"));
  const secureVideo = Boolean(videoSrc && new URL(videoSrc).pathname.startsWith("/api/private-media/"));
  return `
  <div class="card post-card" data-post-id="${post.id}">
    <div class="post-header">
      <a href="${post.business ? `business.html?id=${encodeURIComponent(post.business.id)}` : `profile.html?u=${encodeURIComponent(post.author.username)}`}">${renderAvatar(post.business ? { full_name: post.business.name, avatar_url: post.business.image_url } : post.author, "avatar-md")}</a>
      <div class="post-header-info">
        <a href="${post.business ? `business.html?id=${encodeURIComponent(post.business.id)}` : `profile.html?u=${encodeURIComponent(post.author.username)}`}" class="post-author-name">${escapeHtml(post.business ? post.business.name : post.author.full_name)}${!post.business && post.author.is_verified ? ' <span class="verified-badge" role="img" title="حساب موثّق" aria-label="حساب موثّق"></span>' : ""}</a>
        <div class="post-meta">${post.business ? `بواسطة @${escapeHtml(post.author.username)} · ` : `@${escapeHtml(post.author.username)} · `}${timeAgo(post.created_at)}${post.is_edited ? " · معدّل" : ""}</div>
      </div>
      ${isOwner ? `<button class="post-menu-btn" data-action="menu">⋮</button>` : `<button class="post-menu-btn" data-action="report">⋮</button>`}
    </div>
    ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ""}
    ${imageSrc ? `<div class="post-image"><img ${secureImage ? `data-private-media="${escapeHtml(imageSrc)}"` : `src="${escapeHtml(imageSrc)}"`} alt="" loading="lazy" decoding="async"></div>` : ""}${videoSrc ? (secureVideo ? `<div class="post-video"><video data-private-media="${escapeHtml(videoSrc)}" controls playsinline preload="none"></video></div>` : `<a class="post-video" href="media.html?tab=reels&post_id=${encodeURIComponent(post.id)}"><video src="${escapeHtml(videoSrc)}" muted playsinline preload="metadata"></video><span>▶ فتح الفيديو</span></a>`) : ""}${post.mood_key ? `<div class="post-mood">${post.mood_key === "happy" ? "😊 سعيد" : "😔 حزين"}</div>` : ""}
    <div class="post-actions">
      <button class="post-action-btn ${post.liked_by_me ? "liked" : ""}" data-action="like">
        <span class="icon">${post.liked_by_me ? "❤️" : "🤍"}</span><span class="like-count">${post.likes_count}</span>
      </button>
      <button class="post-action-btn" data-action="toggle-comments">
        <span class="icon">💬</span><span class="comment-count">${post.comments_count}</span>
      </button>
    </div>
    <div class="comments-section hidden" data-comments-for="${post.id}">
      <div class="comments-list"></div>
      <form class="comment-form" data-post-id="${post.id}">
        <input type="text" placeholder="أضف تعليقًا..." maxlength="500" required>
        <button type="submit" class="btn btn-primary btn-sm">إرسال</button>
      </form>
    </div>
  </div>`;
}

function bindPostCardEvents(post) {
  const card = document.querySelector(`.post-card[data-post-id="${post.id}"]`);
  if (!card) return;
  hydratePrivateMedia(card);

  card.querySelector('[data-action="like"]').addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const liked = btn.classList.contains("liked");
    try {
      if (liked) {
        await Api.del(`/api/posts/${post.id}/like`);
      } else {
        await Api.post(`/api/posts/${post.id}/like`);
      }
      const countEl = btn.querySelector(".like-count");
      let count = parseInt(countEl.textContent, 10);
      countEl.textContent = liked ? count - 1 : count + 1;
      btn.classList.toggle("liked");
      btn.querySelector(".icon").textContent = liked ? "🤍" : "❤️";
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  card.querySelector('[data-action="toggle-comments"]').addEventListener("click", () => {
    const section = card.querySelector(`[data-comments-for="${post.id}"]`);
    section.classList.toggle("hidden");
    if (!section.classList.contains("hidden")) loadComments(post.id);
  });

  const commentForm = card.querySelector(".comment-form");
  commentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = commentForm.querySelector("input");
    const content = input.value.trim();
    if (!content) return;
    try {
      await Api.post(`/api/posts/${post.id}/comments`, { content });
      input.value = "";
      loadComments(post.id);
      const countEl = card.querySelector(".comment-count");
      countEl.textContent = parseInt(countEl.textContent, 10) + 1;
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  const menuBtn = card.querySelector('[data-action="menu"]');
  if (menuBtn) {
    menuBtn.addEventListener("click", () => openPostOwnerMenu(post));
  }
  const reportBtn = card.querySelector('[data-action="report"]');
  if (reportBtn) {
    reportBtn.addEventListener("click", () => openReportModal("post", post.id));
  }
}

async function loadComments(postId) {
  const section = document.querySelector(`[data-comments-for="${postId}"] .comments-list`);
  section.innerHTML = '<div class="loading-spinner" style="margin:12px auto;"></div>';
  try {
    const comments = await Api.get(`/api/posts/${postId}/comments`);
    const me = Auth.getCurrentUser();
    section.innerHTML = comments
      .map(
        (c) => `<div class="comment-item" data-comment-id="${c.id}">
        ${renderAvatar(c.author, "avatar-sm")}
        <div class="comment-bubble">
          <div class="comment-author">${escapeHtml(c.author.full_name)}</div>
          <div class="comment-text">${escapeHtml(c.content)}</div>
        </div>
        <div class="comment-actions">${me && me.id === c.author.id ? `<button class="comment-delete" data-comment-id="${c.id}">حذف</button>` : ""}${!me || me.id !== c.author.id ? `<button class="comment-report" data-comment-id="${c.id}" type="button">إبلاغ</button>` : ""}</div>
      </div>`
      )
      .join("") || `<p class="empty-state" style="padding:12px;">لا توجد تعليقات بعد</p>`;

    section.querySelectorAll(".comment-report").forEach((btn) => btn.addEventListener("click", () => openReportModal("comment", btn.dataset.commentId)));
    section.querySelectorAll(".comment-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("هل تريد حذف هذا التعليق؟")) return;
        try {
          await Api.del(`/api/posts/comments/${btn.dataset.commentId}`);
          loadComments(postId);
          const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
          const countEl = card.querySelector(".comment-count");
          countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    section.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
  }
}

function openPostOwnerMenu(post) {
  const choice = prompt("اكتب: تعديل أو حذف أو أرشفة");
  if (choice === "تعديل") {
    const newContent = prompt("عدّل نص المنشور:", post.content || "");
    if (newContent === null) return;
    const formData = new FormData();
    formData.append("content", newContent);
    Api.put(`/api/posts/${post.id}`, formData, true)
      .then(() => {
        showToast("تم تعديل المنشور", "success");
        loadFeed();
      })
      .catch((err) => showToast(err.message, "error"));
  } else if (choice === "أرشفة") {
    if (!confirm("سيختفي المنشور من الخلاصات دون حذفه. متابعة؟")) return;
    Api.post(`/api/account/archive/posts/${encodeURIComponent(post.id)}`)
      .then(() => { showToast("تمت أرشفة المنشور", "success"); loadFeed(); })
      .catch((err) => showToast(err.message, "error"));
  } else if (choice === "حذف") {
    if (!confirm("هل تريد حذف هذا المنشور نهائيًا؟")) return;
    const deletePath = post.video_url || post.mood_key ? `/api/media/posts/${post.id}` : `/api/posts/${post.id}`;
    Api.del(deletePath)
      .then(() => {
        showToast("تم حذف المنشور", "success");
        loadFeed();
      })
      .catch((err) => showToast(err.message, "error"));
  }
}

let reportModalSequence = 0;
async function openReportModal(targetType, targetId) {
  const previousFocus = document.activeElement;
  const old = document.getElementById("ytrana-report-dialog");
  if (old && old.dataset.busy === "true") return;
  if (old) { if (old.reportClose) old.reportClose(); else old.remove(); }
  const sequence = ++reportModalSequence;

  const fallbackCategories = [
    ["spam", "رسائل مزعجة", "محتوى متكرر أو ترويجي غير مرغوب"],
    ["harassment", "مضايقة", "استهداف أو إساءة لشخص آخر"],
    ["hate", "كراهية", "تحريض أو كراهية ضد فئة أو شخص"],
    ["violence", "عنف", "تهديد أو تمجيد للعنف"],
    ["sexual", "محتوى جنسي", "محتوى جنسي أو غير ملائم"],
    ["impersonation", "انتحال", "التظاهر بأنك شخص أو جهة أخرى"],
    ["scam", "احتيال", "خداع أو طلبات مالية مشبوهة"],
    ["privacy", "خصوصية", "نشر معلومات شخصية دون إذن"],
    ["copyright", "حقوق نشر", "استخدام محتوى محمي دون تصريح"],
    ["other", "أخرى", "سبب آخر يخالف إرشادات المجتمع"]
  ];
  let categories = fallbackCategories;
  try {
    const options = await Api.get("/api/reports/options");
    if (Array.isArray(options.categories)) {
      categories = options.categories.map((item) => {
        const value = Array.isArray(item) ? item[0] : item;
        const known = fallbackCategories.find((entry) => entry[0] === value);
        return [value, Array.isArray(item) ? item[1] : (known ? known[1] : value), known ? known[2] : "اختر هذا السبب لمساعدة فريق المراجعة"];
      });
    } else if (options.categories && typeof options.categories === "object") {
      categories = Object.entries(options.categories).map(([value, text]) => {
        const known = fallbackCategories.find((entry) => entry[0] === value);
        return [value, known ? known[1] : text, known ? known[2] : "اختر هذا السبب لمساعدة فريق المراجعة"];
      });
    }
    if (Array.isArray(options.target_types) && !options.target_types.includes(targetType)) {
      showToast("هذا النوع غير متاح للإبلاغ", "error");
      return;
    }
  } catch (_) { /* use safe defaults when options are unavailable */ }
  if (sequence !== reportModalSequence) return;
  if (!categories.length) categories = fallbackCategories;

  const dialog = document.createElement("div");
  dialog.id = "ytrana-report-dialog";
  dialog.className = "report-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "report-dialog-title");
  dialog.setAttribute("aria-describedby", "report-dialog-description");
  const panel = document.createElement("section");
  panel.className = "report-panel";
  panel.tabIndex = -1;
  const header = document.createElement("div");
  header.className = "report-header";
  const title = document.createElement("h2");
  title.id = "report-dialog-title";
  title.textContent = "إبلاغ عن محتوى";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "report-close";
  close.setAttribute("aria-label", "إغلاق نافذة البلاغ");
  close.textContent = "×";
  const description = document.createElement("p");
  description.id = "report-dialog-description";
  description.className = "report-description";
  description.textContent = "اختر السبب الأقرب، ويمكنك إضافة تفاصيل اختيارية.";
  header.append(title, close);
  const group = document.createElement("fieldset");
  group.className = "report-options";
  const legend = document.createElement("legend");
  legend.textContent = "ما سبب البلاغ؟";
  group.appendChild(legend);
  const optionInputs = [];
  categories.forEach(([value, text, detail], index) => {
    const label = document.createElement("label");
    label.className = "report-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "report-category";
    input.value = value;
    input.checked = index === 0;
    const card = document.createElement("span");
    card.className = "report-option-card";
    const name = document.createElement("strong");
    name.textContent = text;
    const hint = document.createElement("small");
    hint.textContent = detail;
    card.append(name, hint);
    label.append(input, card);
    group.appendChild(label);
    optionInputs.push(input);
  });
  const reasonLabel = document.createElement("label");
  reasonLabel.className = "report-reason-label";
  reasonLabel.htmlFor = "report-reason";
  reasonLabel.textContent = "تفاصيل إضافية (اختياري)";
  const textarea = document.createElement("textarea");
  textarea.id = "report-reason";
  textarea.className = "report-reason";
  textarea.maxLength = 500;
  textarea.rows = 4;
  textarea.placeholder = "أضف تفاصيل تساعد فريق المراجعة";
  const counter = document.createElement("span");
  counter.className = "report-counter";
  counter.textContent = "0/500";
  textarea.addEventListener("input", () => { counter.textContent = `${textarea.value.length}/500`; });
  const error = document.createElement("p");
  error.className = "report-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = document.createElement("div");
  actions.className = "report-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "report-button report-button-secondary";
  cancel.textContent = "إلغاء";
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "report-button report-button-primary";
  submit.textContent = "إرسال البلاغ";
  actions.append(cancel, submit);
  panel.append(header, description, group, reasonLabel, textarea, counter, error, actions);
  dialog.appendChild(panel);

  const host = document.querySelector("dialog[open]") || document.body;
  host.querySelectorAll("video").forEach((player) => player.pause());
  host.appendChild(dialog);
  document.body.classList.add("report-dialog-open");
  let closing = false;
  const restore = () => {
    if (closing) return;
    if (dialog.dataset.busy === "true") return;
    closing = true;
    document.removeEventListener("keydown", onKeydown, true);
    dialog.remove();
    document.body.classList.remove("report-dialog-open");
    if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) previousFocus.focus();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); restore(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll("button, input, textarea, [href], select, [tabindex]:not([tabindex='-1'])")).filter(node => !node.disabled && (node.type !== "radio" || node.checked));
    if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement) || document.activeElement === panel) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  dialog.reportClose = restore;
  document.addEventListener("keydown", onKeydown, true);
  close.addEventListener("click", restore);
  cancel.addEventListener("click", restore);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) restore(); });
  submit.addEventListener("click", async () => {
    if (submit.disabled) return;
    const selected = optionInputs.find((input) => input.checked);
    const fallback = categories.find(([value]) => value === selected?.value)?.[1] || "بلاغ";
    const reason = textarea.value.trim() || fallback;
    if (reason.length < 3 || reason.length > 500) {
      error.textContent = "اكتب سببًا من 3 إلى 500 حرف";
      error.hidden = false;
      textarea.focus();
      return;
    }
    error.hidden = true;
    dialog.dataset.busy = "true";
    [submit, cancel, close, textarea, ...optionInputs].forEach(node => node.disabled = true);
    panel.focus();
    submit.classList.add("is-loading");
    submit.textContent = "جارٍ الإرسال…";
    try {
      await Api.post("/api/reports", { target_type: targetType, target_id: targetId, category: selected?.value || categories[0][0], reason });
      dialog.dataset.busy = "false";
      restore();
      showToast("تم إرسال البلاغ، شكرًا لك", "success");
    } catch (err) {
      error.textContent = err.message || "تعذّر إرسال البلاغ. حاول مرة أخرى.";
      error.hidden = false;
      dialog.dataset.busy = "false";
      [submit, cancel, close, textarea, ...optionInputs].forEach(node => node.disabled = false);
      submit.classList.remove("is-loading");
      submit.textContent = "إعادة المحاولة";
      submit.focus();
    }
  });
  panel.focus();
}

async function hydratePrivateMedia(root = document) {
  const nodes = Array.from(root.querySelectorAll("[data-private-media]"));
  for (const node of nodes) {
    const url = node.dataset.privateMedia;
    if (!url || node.dataset.loading === "true") continue;
    node.dataset.loading = "true";
    try {
      const token = Api.getToken();
      const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("تعذّر تحميل الوسيط المحمي");
      const blobUrl = URL.createObjectURL(await response.blob());
      if (!node.isConnected) { URL.revokeObjectURL(blobUrl); continue; }
      node.src = blobUrl;
      node.removeAttribute("data-private-media");
    } catch (_error) {
      node.alt = "الوسيط متاح لأعضاء الدائرة فقط";
      node.classList.add("private-media-error");
    } finally { node.dataset.loading = "false"; }
  }
}
