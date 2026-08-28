// توليد صورة رمزية افتراضية (حرف أول من الاسم) عندما لا توجد صورة شخصية
function renderAvatar(user, sizeClass = "avatar-md") {
  if (user && user.avatar_url) {
    const src = user.avatar_url.startsWith("http")
      ? user.avatar_url
      : `${YTRANA_CONFIG.API_BASE}${user.avatar_url}`;
    return `<img src="${src}" class="avatar ${sizeClass}" alt="${escapeHtml(user.username || "")}">`;
  }
  const letter = user && user.full_name ? user.full_name.trim()[0].toUpperCase() : "Y";
  return `<div class="avatar ${sizeClass} avatar-placeholder">${letter}</div>`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function timeAgo(dateString) {
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);
  const intervals = [
    { label: "سنة", secs: 31536000 },
    { label: "شهر", secs: 2592000 },
    { label: "يوم", secs: 86400 },
    { label: "ساعة", secs: 3600 },
    { label: "دقيقة", secs: 60 },
  ];
  for (const i of intervals) {
    const count = Math.floor(seconds / i.secs);
    if (count >= 1) return `منذ ${count} ${i.label}${count > 1 && count < 11 ? (i.label === "شهر" ? "أشهر" : i.label + "ات") : ""}`;
  }
  return "الآن";
}
