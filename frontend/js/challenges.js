Layout.init("community");
const challengeId = Number(new URLSearchParams(location.search).get("id")) || null;
let challengeState = "all";
let activeChallenge = null;

function challengeDate(value) { return value ? new Date(value).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" }) : ""; }
function stateLabel(state) { return ({ active: "نشط", upcoming: "قادم", ended: "منتهٍ", paused: "موقوف" })[state] || state; }
function challengeCard(item) {
  return `<a class="entity-card card" href="challenges.html?id=${item.id}"><span class="entity-avatar entity-avatar-placeholder">${item.period === "daily" ? "ي" : "أ"}</span><div class="entity-card-main"><h3>${escapeHtml(item.title)} <span class="pill">${item.period === "daily" ? "يومي" : "أسبوعي"}</span></h3><p>${escapeHtml(item.description || "بدون تفاصيل إضافية")}</p><div class="entity-meta"><span>${stateLabel(item.state)}</span><span>${item.participants_count} مشارك</span><span>${item.posts_count} مشاركة</span><span>ينتهي ${challengeDate(item.ends_at)}</span></div></div><span class="btn btn-outline btn-sm">التفاصيل</span></a>`;
}
async function loadChallenges(state = challengeState) {
  challengeState = state;
  const host = document.getElementById("challenge-list");
  host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const items = await Api.get(`/api/challenges?state=${encodeURIComponent(state)}&limit=50`);
    host.innerHTML = items.length ? items.map(challengeCard).join("") : '<p class="feature-empty">لا توجد تحديات بهذه الحالة حاليًا.</p>';
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
async function loadAchievements() {
  const host = document.getElementById("challenge-achievements");
  try {
    const list = await Api.get("/api/challenges/mine/achievements");
    host.innerHTML = list.length ? list.map((item) => `<span class="feature-status success">✦ ${escapeHtml(item.badge)} · ${escapeHtml(item.challenge.title)}</span>`).join("") : '<span class="feature-subtitle">ستظهر هنا شارات مشاركاتك.</span>';
  } catch (_err) { host.innerHTML = '<span class="feature-subtitle">سجّل مشاركتك الأولى لتظهر إنجازاتك هنا.</span>'; }
}
async function checkAdmin() {
  try { const user = await Api.get("/api/auth/me"); document.getElementById("challenge-admin").classList.toggle("hidden", !user.is_admin); }
  catch (_err) { document.getElementById("challenge-admin").classList.add("hidden"); }
}

async function loadChallengeDetail() {
  document.getElementById("challenge-list-view").classList.add("hidden");
  document.getElementById("challenge-detail-view").classList.remove("hidden");
  const detail = document.getElementById("challenge-detail");
  const entries = document.getElementById("challenge-entries");
  detail.innerHTML = '<div class="loading-spinner"></div>';
  try {
    activeChallenge = await Api.get(`/api/challenges/${challengeId}`);
    const item = activeChallenge;
    const isAdmin = (await Api.get("/api/auth/me").catch(() => ({}))).is_admin;
    detail.innerHTML = `<section class="card feature-panel"><div class="feature-inline"><span class="feature-icon">✦</span><div><h1>${escapeHtml(item.title)}</h1><div class="entity-meta"><span class="pill">${item.period === "daily" ? "تحدٍ يومي" : "تحدٍ أسبوعي"}</span><span class="pill">${stateLabel(item.state)}</span></div></div></div><p class="feature-subtitle">${escapeHtml(item.description || "")}</p><div class="metric-strip"><div class="metric-box"><strong>${item.participants_count}</strong><span>مشارك</span></div><div class="metric-box"><strong>${item.posts_count}</strong><span>مشاركة</span></div><div class="metric-box"><strong>${item.likes_count}</strong><span>إعجاب</span></div><div class="metric-box"><strong>${challengeDate(item.ends_at)}</strong><span>موعد الانتهاء</span></div></div>${isAdmin ? `<div class="feature-inline">${item.state === "paused" ? `<button id="challenge-resume" class="btn btn-outline">إعادة التفعيل</button>` : `<button id="challenge-pause" class="btn btn-outline">إيقاف التحدي</button>`}</div>` : ""}</section>`;
    const form = document.getElementById("challenge-post-form");
    form.classList.toggle("hidden", item.state !== "active" || Boolean(item.my_post_id));
    if (item.my_post_id) form.insertAdjacentHTML("beforebegin", '<p class="feature-status success">شاركت بالفعل في هذا التحدي؛ احتُسبت مشاركتك ضمن اللوحة.</p>');
    if (document.getElementById("challenge-pause")) document.getElementById("challenge-pause").onclick = () => changeChallengeState("pause");
    if (document.getElementById("challenge-resume")) document.getElementById("challenge-resume").onclick = () => changeChallengeState("resume");
    await loadChallengeEntries();
  } catch (err) { detail.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; entries.innerHTML = ""; }
}
async function changeChallengeState(action) {
  try { await Api.put(`/api/challenges/${challengeId}/${action}`); showToast(action === "pause" ? "تم إيقاف التحدي" : "تمت إعادة تفعيل التحدي", "success"); await loadChallengeDetail(); }
  catch (err) { showToast(err.message, "error"); }
}
async function loadChallengeEntries() {
  const host = document.getElementById("challenge-entries");
  host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const rows = await Api.get(`/api/challenges/${challengeId}/posts?limit=50`);
    host.innerHTML = rows.length ? rows.map((row) => `<div class="challenge-entry"><span class="rank-badge">${row.rank}</span><strong>${row.engagement_count} إعجاب</strong></div>${renderPostCard(row.post)}`).join("") : '<p class="feature-empty">لا توجد مشاركات بعد.</p>';
    rows.forEach((row) => bindPostCardEvents(row.post));
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
window.loadFeed = loadChallengeEntries;

document.getElementById("challenge-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const startsAt = new Date(data.get("starts_at"));
  const endsAt = new Date(data.get("ends_at"));
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return showToast("تحقق من وقت البداية والنهاية", "error");
  const payload = { title: data.get("title"), description: data.get("description"), period: data.get("period"), starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), image_url: data.get("image_url") || null };
  try { await Api.post("/api/challenges", payload); form.reset(); showToast("تم إنشاء التحدي", "success"); await loadChallenges(); }
  catch (err) { showToast(err.message, "error"); }
});

document.getElementById("challenge-post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(); data.set("content", form.elements.content.value); data.set("challenge_id", String(challengeId));
  const file = form.elements.media.files[0]; if (file) data.set(file.type.startsWith("video/") ? "video" : "image", file);
  try { await Api.post("/api/posts", data, true); showToast("أُرسلت مشاركتك", "success"); await loadChallengeDetail(); loadAchievements(); }
  catch (err) { showToast(err.message, "error"); }
});

document.querySelectorAll("#challenge-tabs [data-state]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("#challenge-tabs [data-state]").forEach((item) => item.classList.toggle("active", item === button));
  loadChallenges(button.dataset.state);
}));
checkAdmin(); loadAchievements();
if (challengeId) loadChallengeDetail(); else loadChallenges();
