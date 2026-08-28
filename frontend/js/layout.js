// يبني الهيدر وشريط التنقل السفلي المشتركين بين كل الصفحات المسجّل دخولها
const Layout = (() => {
  function renderHeader(activePage) {
    const header = document.getElementById("y-header");
    if (!header) return;
    header.innerHTML = `
      <a href="index.html" class="y-logo">Ytrana</a>
      <div class="y-header-actions">
        <label class="switch" title="الوضع الليلي">
          <input type="checkbox" class="theme-toggle-input">
          <span class="switch-slider"></span>
        </label>
        <a class="icon-btn" href="notifications.html" aria-label="الإشعارات">
          🔔<span class="badge-dot" id="notif-badge"></span>
        </a>
      </div>
    `;
    header.querySelector(".theme-toggle-input").addEventListener("change", Theme.toggle);
    Theme.init();
  }

  function renderBottomNav(activePage) {
    const nav = document.getElementById("y-bottom-nav");
    if (!nav) return;
    const user = Auth.getCurrentUser();
    const items = [
      { key: "index", href: "index.html", icon: "🏠", label: "الرئيسية" },
      { key: "search", href: "search.html", icon: "🔍", label: "بحث" },
      { key: "notifications", href: "notifications.html", icon: "🔔", label: "الإشعارات" },
      { key: "profile", href: user ? `profile.html?u=${encodeURIComponent(user.username)}` : "login.html", icon: "👤", label: "حسابي" },
    ];
    nav.innerHTML = items
      .map(
        (i) => `<a href="${i.href}" class="${i.key === activePage ? "active" : ""}">
          <span class="nav-icon">${i.icon}</span><span>${i.label}</span>
        </a>`
      )
      .join("");
  }

  async function refreshNotifBadge() {
    if (!Auth.isLoggedIn()) return;
    try {
      const res = await Api.get("/api/notifications/unread-count");
      const badge = document.getElementById("notif-badge");
      if (badge) badge.classList.toggle("show", res.unread_count > 0);
    } catch (e) {
      // تجاهل بصمت؛ ليست عملية حرجة
    }
  }

  function init(activePage) {
    Auth.requireAuth();
    renderHeader(activePage);
    renderBottomNav(activePage);
    refreshNotifBadge();
  }

  return { init, refreshNotifBadge };
})();
