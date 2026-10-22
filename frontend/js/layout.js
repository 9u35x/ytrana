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
    addAdminLinkIfAllowed(header);
  }

  async function addAdminLinkIfAllowed(header) {
    if (!header || header.querySelector('[data-admin-link]') || window.location.pathname.endsWith("/admin.html")) return;
    const tokenAtStart = Api.getToken();
    if (!tokenAtStart) return;
    try {
      const access = await Api.get("/api/admin/access");
      if (tokenAtStart !== Api.getToken() || !access || access.allowed !== true || header.querySelector('[data-admin-link]')) return;
      const link = document.createElement("a"); link.href = "admin.html"; link.className = "btn btn-outline btn-sm"; link.dataset.adminLink = "true"; link.textContent = "الإدارة"; link.setAttribute("aria-label", "إدارة الحسابات والبلاغات");
      header.querySelector(".y-header-actions")?.prepend(link);
    } catch (_) { /* non-admin users keep the normal header */ }
  }

  function renderBottomNav(activePage) {
    const nav = document.getElementById("y-bottom-nav");
    if (!nav) return;
    const user = Auth.getCurrentUser();
    const items = [
      { key: "index", href: "index.html", icon: "🏠", label: "الرئيسية" },
      { key: "media", href: "media.html", icon: "✨", label: "وسائط" },
      { key: "community", href: "community.html", icon: "🌐", label: "المجتمع" },
      { key: "search", href: "search.html", icon: "🔍", label: "بحث" },
      { key: "messages", href: "messages.html", icon: "💬", label: "الدردشة", badgeId: "messages-badge" },
      { key: "notifications", href: "notifications.html", icon: "🔔", label: "الإشعارات" },
      { key: "profile", href: user ? `profile.html?u=${encodeURIComponent(user.username)}` : "login.html", icon: "👤", label: "حسابي" },
    ];
    nav.innerHTML = items
      .map(
        (i) => `<a href="${i.href}" class="${i.key === activePage ? "active" : ""}">
          <span class="nav-icon">${i.icon}${i.badgeId ? `<span class="badge-dot" id="${i.badgeId}"></span>` : ""}</span><span>${i.label}</span>
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

  async function refreshMessagesBadge() {
    if (!Auth.isLoggedIn()) return;
    try {
      const res = await Api.get("/api/messages/unread-count");
      const badge = document.getElementById("messages-badge");
      if (badge) badge.classList.toggle("show", res.unread_count > 0);
    } catch (e) {
      // تجاهل بصمت؛ ليست عملية حرجة
    }
  }

  function ensurePwaMetadata() {
    const setMeta = (name, content) => {
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.name = name;
        document.head.appendChild(tag);
      }
      tag.content = content;
    };
    setMeta("theme-color", "#6C5CE7");
    setMeta("mobile-web-app-capable", "yes");
    setMeta("apple-mobile-web-app-capable", "yes");
    setMeta("apple-mobile-web-app-title", "Ytrana");
    setMeta("apple-mobile-web-app-status-bar-style", "default");

    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && !viewport.content.includes("viewport-fit=cover")) {
      viewport.content += ", viewport-fit=cover";
    }
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement("link");
      manifest.rel = "manifest";
      manifest.href = "/manifest.json";
      document.head.appendChild(manifest);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const icon = document.createElement("link");
      icon.rel = "apple-touch-icon";
      icon.href = "/apple-touch-icon.png";
      document.head.appendChild(icon);
    }
  }

  function init(activePage) {
    Auth.requireAuth();
    ensurePwaMetadata();
    renderHeader(activePage);
    renderBottomNav(activePage);
    refreshNotifBadge();
    refreshMessagesBadge();
  }

  return { init, refreshNotifBadge, refreshMessagesBadge };
})();
