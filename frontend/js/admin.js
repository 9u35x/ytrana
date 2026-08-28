// منطق لوحة الإدارة (متاحة فقط لحسابات is_admin)
document.addEventListener("DOMContentLoaded", async () => {
  Auth.requireAuth();
  Theme.init();
  const me = Auth.getCurrentUser();
  if (!me) return;

  try {
    const fresh = await Api.get("/api/auth/me");
    Auth.setCurrentUser(fresh);
    if (!fresh.is_admin) {
      document.body.innerHTML = `<div class="empty-state" style="margin-top:60px;">
        <div class="icon">🚫</div><p>هذه الصفحة مخصصة لفريق الإدارة فقط</p>
        <a class="btn btn-primary mt-4" href="index.html">العودة للرئيسية</a>
      </div>`;
      return;
    }
  } catch (e) {
    window.location.href = "login.html";
    return;
  }

  document.getElementById("admin-tab-users").addEventListener("click", () => switchAdminTab("users"));
  document.getElementById("admin-tab-reports").addEventListener("click", () => switchAdminTab("reports"));
  switchAdminTab("users");
});

let adminTab = "users";
function switchAdminTab(tab) {
  adminTab = tab;
  document.getElementById("admin-tab-users").classList.toggle("active", tab === "users");
  document.getElementById("admin-tab-reports").classList.toggle("active", tab === "reports");
  if (tab === "users") loadAdminUsers();
  else loadAdminReports();
}

async function loadAdminUsers() {
  const box = document.getElementById("admin-content");
  box.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const users = await Api.get("/api/admin/users?limit=100");
    box.innerHTML = users
      .map(
        (u) => `<div class="user-list-item">
        ${renderAvatar(u, "avatar-md")}
        <div class="user-list-item-info">
          <div class="user-list-item-name">${escapeHtml(u.full_name)} ${u.is_banned ? '<span style="color:var(--y-danger);font-size:12px;">(محظور)</span>' : ""}</div>
          <div class="user-list-item-username">@${escapeHtml(u.username)}</div>
        </div>
        <button class="btn btn-sm ${u.is_banned ? "btn-outline" : "btn-danger"}" data-id="${u.id}" data-banned="${u.is_banned}">
          ${u.is_banned ? "إلغاء الحظر" : "حظر"}
        </button>
      </div>`
      )
      .join("");

    box.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const banned = btn.dataset.banned === "true";
        try {
          await Api.put(`/api/admin/users/${btn.dataset.id}/${banned ? "unban" : "ban"}`);
          loadAdminUsers();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadAdminReports() {
  const box = document.getElementById("admin-content");
  box.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const reports = await Api.get("/api/admin/reports?status_filter=pending&limit=100");
    if (reports.length === 0) {
      box.innerHTML = `<div class="empty-state"><p>لا توجد بلاغات قيد الانتظار</p></div>`;
      return;
    }
    box.innerHTML = reports
      .map(
        (r) => `<div class="card" style="padding: var(--y-space-4); margin: var(--y-space-3) 0;">
        <div class="post-meta">بلاغ من @${escapeHtml(r.reporter.username)} · ${timeAgo(r.created_at)}</div>
        <div style="margin:8px 0;"><b>النوع:</b> ${r.target_type} · <b>المعرّف:</b> ${r.target_id}</div>
        <div class="post-content">${escapeHtml(r.reason)}</div>
        <div class="modal-actions">
          ${r.target_type === "post" ? `<button class="btn btn-danger btn-sm" data-del-post="${r.target_id}">حذف المنشور</button>` : ""}
          ${r.target_type === "comment" ? `<button class="btn btn-danger btn-sm" data-del-comment="${r.target_id}">حذف التعليق</button>` : ""}
          <button class="btn btn-outline btn-sm" data-dismiss="${r.id}">رفض البلاغ</button>
          <button class="btn btn-primary btn-sm" data-review="${r.id}">تمت المراجعة</button>
        </div>
      </div>`
      )
      .join("");

    box.querySelectorAll("[data-del-post]").forEach((b) =>
      b.addEventListener("click", () =>
        Api.del(`/api/admin/posts/${b.dataset.delPost}`).then(loadAdminReports).catch((e) => showToast(e.message, "error"))
      )
    );
    box.querySelectorAll("[data-del-comment]").forEach((b) =>
      b.addEventListener("click", () =>
        Api.del(`/api/admin/comments/${b.dataset.delComment}`).then(loadAdminReports).catch((e) => showToast(e.message, "error"))
      )
    );
    box.querySelectorAll("[data-dismiss]").forEach((b) =>
      b.addEventListener("click", () =>
        Api.put(`/api/admin/reports/${b.dataset.dismiss}/dismiss`).then(loadAdminReports).catch((e) => showToast(e.message, "error"))
      )
    );
    box.querySelectorAll("[data-review]").forEach((b) =>
      b.addEventListener("click", () =>
        Api.put(`/api/admin/reports/${b.dataset.review}/review`).then(loadAdminReports).catch((e) => showToast(e.message, "error"))
      )
    );
  } catch (err) {
    box.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}
