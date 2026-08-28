// منطق صفحة البحث عن المستخدمين
document.addEventListener("DOMContentLoaded", () => {
  Layout.init("search");

  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  let debounceTimer = null;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>ابحث باسم المستخدم أو الاسم</p></div>`;
      return;
    }
    debounceTimer = setTimeout(() => runSearch(q), 300);
  });

  async function runSearch(q) {
    results.innerHTML = '<div class="loading-spinner"></div>';
    try {
      const users = await Api.get(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (users.length === 0) {
        results.innerHTML = `<div class="empty-state"><p>لا توجد نتائج لـ "${escapeHtml(q)}"</p></div>`;
        return;
      }
      results.innerHTML = users
        .map(
          (u) => `<a class="user-list-item" href="profile.html?u=${encodeURIComponent(u.username)}">
          ${renderAvatar(u, "avatar-md")}
          <div class="user-list-item-info">
            <div class="user-list-item-name">${escapeHtml(u.full_name)}</div>
            <div class="user-list-item-username">@${escapeHtml(u.username)}</div>
          </div>
        </a>`
        )
        .join("");
    } catch (err) {
      results.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  results.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>ابحث باسم المستخدم أو الاسم</p></div>`;
});
