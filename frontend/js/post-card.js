// عناصر ووظائف بطاقة المنشور المشتركة بين الصفحة الرئيسية والملف الشخصي
function renderPostCard(post) {
  const me = Auth.getCurrentUser();
  const isOwner = me && me.id === post.author.id;
  return `
  <div class="card post-card" data-post-id="${post.id}">
    <div class="post-header">
      <a href="profile.html?u=${encodeURIComponent(post.author.username)}">${renderAvatar(post.author, "avatar-md")}</a>
      <div class="post-header-info">
        <a href="profile.html?u=${encodeURIComponent(post.author.username)}" class="post-author-name">${escapeHtml(post.author.full_name)}</a>
        <div class="post-meta">@${escapeHtml(post.author.username)} · ${timeAgo(post.created_at)}${post.is_edited ? " · معدّل" : ""}</div>
      </div>
      ${isOwner ? `<button class="post-menu-btn" data-action="menu">⋮</button>` : `<button class="post-menu-btn" data-action="report">⋮</button>`}
    </div>
    ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ""}
    ${post.image_url ? `<div class="post-image"><img src="${YTRANA_CONFIG.API_BASE}${post.image_url}" alt=""></div>` : ""}
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
        ${me && me.id === c.author.id ? `<button class="comment-delete" data-comment-id="${c.id}">حذف</button>` : ""}
      </div>`
      )
      .join("") || `<p class="empty-state" style="padding:12px;">لا توجد تعليقات بعد</p>`;

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
  const choice = prompt("اكتب: تعديل أو حذف");
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
  } else if (choice === "حذف") {
    if (!confirm("هل تريد حذف هذا المنشور نهائيًا؟")) return;
    Api.del(`/api/posts/${post.id}`)
      .then(() => {
        showToast("تم حذف المنشور", "success");
        loadFeed();
      })
      .catch((err) => showToast(err.message, "error"));
  }
}

function openReportModal(targetType, targetId) {
  const reason = prompt("سبب الإبلاغ:");
  if (!reason || reason.trim().length < 3) return;
  Api.post("/api/reports", { target_type: targetType, target_id: targetId, reason: reason.trim() })
    .then(() => showToast("تم إرسال البلاغ، شكرًا لك", "success"))
    .catch((err) => showToast(err.message, "error"));
}
