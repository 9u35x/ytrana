// منطق صفحة الإشعارات
const NOTIF_TEXT = {
  follow: "بدأ بمتابعتك",
  like: "أعجب بمنشورك",
  comment: "علّق على منشورك",
};

document.addEventListener("DOMContentLoaded", () => {
  Layout.init("notifications");
  loadNotifications();

  document.getElementById("mark-all-read")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      await Api.put("/api/notifications/read-all");
      showToast("تم تحديد الإشعارات كمقروءة", "success");
      await loadNotifications();
      Layout.refreshNotifBadge();
    } catch (err) {
      showToast(err.message, "error");
      button.disabled = false;
    }
  });
});

async function loadNotifications() {
  const list = document.getElementById("notif-list");
  const markAllButton = document.getElementById("mark-all-read");
  if (!list) return;
  list.innerHTML = '<div class="loading-spinner" role="status" aria-label="جارٍ تحميل الإشعارات"></div>';
  try {
    const [notifs, unread] = await Promise.all([
      Api.get("/api/notifications?skip=0&limit=50"),
      Api.get("/api/notifications/unread-count"),
    ]);
    if (markAllButton) {
      const count = Number(unread?.unread_count || 0);
      markAllButton.disabled = count === 0;
      markAllButton.textContent = count ? `تحديد الكل كمقروء (${count})` : "كل الإشعارات مقروءة";
      markAllButton.setAttribute("aria-label", count ? `تحديد ${count} إشعارًا كمقروء` : "كل الإشعارات مقروءة");
    }
    if (!notifs || notifs.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="icon">🔔</div><p>لا توجد إشعارات بعد</p><small>ستظهر هنا المتابعات والتفاعلات الجديدة.</small></div>`;
      return;
    }
    list.innerHTML = notifs.map((n) => {
      const href = `profile.html?u=${encodeURIComponent(n.actor.username)}`;
      const action = NOTIF_TEXT[n.type] || "تفاعل معك";
      return `<a class="notif-item ${n.is_read ? "" : "unread"}" href="${href}" data-id="${Number(n.id)}" style="color:inherit;text-decoration:none;">
        ${renderAvatar(n.actor, "avatar-md")}
        <div style="flex:1;min-width:0;">
          <div class="notif-text"><b>${escapeHtml(n.actor.full_name)}</b> ${action}</div>
          <div class="notif-time">${timeAgo(n.created_at)}${n.is_read ? "" : " · جديد"}</div>
        </div>
        ${n.is_read ? "" : '<span class="notif-unread-dot" aria-label="غير مقروء"></span>'}
      </a>`;
    }).join("");

    list.querySelectorAll(".notif-item.unread").forEach((item) => {
      item.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await Api.put(`/api/notifications/${item.dataset.id}/read`);
          Layout.refreshNotifBadge();
        } catch (err) {
          showToast("تعذر تحديث حالة الإشعار، سيتم فتح الملف الشخصي", "error");
        }
        window.location.href = item.href;
      });
    });
  } catch (err) {
    if (markAllButton) markAllButton.disabled = true;
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}
