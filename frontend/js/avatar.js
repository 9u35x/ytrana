// توليد صورة رمزية آمنة، أو الحرف الأول من الاسم عند غياب الصورة.
function uploadedImageUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return null;
  try {
    const apiBase = new URL(YTRANA_CONFIG.API_BASE, window.location.href);
    const imageUrl = new URL(rawUrl, apiBase);
    if (imageUrl.origin !== apiBase.origin || !imageUrl.pathname.startsWith("/uploads/")) return null;
    return imageUrl.href;
  } catch (_error) {
    return null;
  }
}

function renderAvatar(user, sizeClass = "avatar-md") {
  const src = user && uploadedImageUrl(user.avatar_url);
  if (src) {
    return `<img src="${escapeHtml(src)}" class="avatar ${sizeClass}" alt="${escapeHtml(user.username || "")}" loading="lazy" decoding="async">`;
  }
  const name = user && typeof user.full_name === "string" ? user.full_name.trim() : "";
  const letter = name ? Array.from(name)[0].toLocaleUpperCase() : "Y";
  return `<div class="avatar ${sizeClass} avatar-placeholder" aria-hidden="true">${escapeHtml(letter)}</div>`;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function timeAgo(dateString) {
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "الآن";
  const intervals = [
    { label: "سنة", secs: 31536000 },
    { label: "شهر", secs: 2592000 },
    { label: "يوم", secs: 86400 },
    { label: "ساعة", secs: 3600 },
    { label: "دقيقة", secs: 60 },
  ];
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.secs);
    if (count >= 1) return `منذ ${count} ${interval.label}${count > 1 && count < 11 ? (interval.label === "شهر" ? "أشهر" : interval.label + "ات") : ""}`;
  }
  return "الآن";
}
