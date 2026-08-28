// منطق صفحة الإشعارات
document.addEventListener("DOMContentLoaded", () => {
  Layout.init("notifications");
  loadNotifications();

  document.getElementById("mark-all-read").addEventListener("click", async () => {
    try {
      await Api.put("/api/notifications/read-all");
      loadNotifications();
      Layout.refreshNotifBadge();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
});

const NOTIF_TEXT = {
  follow: "بدأ بمتابعتك",
  like: "أعجب بمنشورك",
  comment: "علّق على منشورك",
};

async function loadNotifications() {
  const list = document.getElementById("notif-list");
  list.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const notifs = await Api.get("/api/notifications");
    if (notifs.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="icon">🔔</div><p>لا توجد إشعارات بعد</p></div>`;
      return;
    }
    list.innerHTML = notifs
      .map(
        (n) => `<div class="notif-item ${n.is_read ? "" : "unread"}" data-id="${n.id}">
        <a href="profile.html?u=${encodeURIComponent(n.actor.username)}">${renderAvatar(n.actor, "avatar-md")}</a>
        <div style="flex:1;">
          <div class="notif-text"><b>${escapeHtml(n.actor.full_name)}</b> ${NOTIF_TEXT[n.type] || ""}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll(".notif-item.unread").forEach((el) => {
      el.addEventListener("click", async () => {
        try {
          await Api.put(`/api/notifications/${el.dataset.id}/read`);
          el.classList.remove("unread");
          Layout.refreshNotifBadge();
        } catch (e) {
          // تجاهل
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}
