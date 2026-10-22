Layout.init("community");
const circleId = Number(new URLSearchParams(location.search).get("id")) || null;
let activeCircle = null;
let privateRequestMode = false;

function circleCan(capability) {
  return !!activeCircle && (activeCircle.my_role === "owner" || (activeCircle.my_role === "moderator" && (activeCircle.moderator_capabilities || []).includes(capability)));
}

function circleMedia(url) { return url ? postMediaUrl(url) : null; }
function dateLabel(value) { return value ? new Date(value).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" }) : ""; }
function circleImageMarkup(url, className, alt = "") {
  const src = circleMedia(url);
  if (!src) return "";
  const protectedMedia = new URL(src).pathname.startsWith("/api/private-media/");
  return `<img class="${className}" ${protectedMedia ? `data-private-media="${escapeHtml(src)}"` : `src="${escapeHtml(src)}"`} alt="${escapeHtml(alt)}">`;
}
function circleCard(circle) {
  const avatar = circleMedia(circle.image_url);
  return `<a class="entity-card card" href="circles.html?id=${circle.id}">
    ${avatar ? circleImageMarkup(circle.image_url, "entity-avatar", "") : `<span class="entity-avatar entity-avatar-placeholder">${escapeHtml((circle.name || "د").slice(0,1))}</span>`}
    <div class="entity-card-main"><h3>${escapeHtml(circle.name)} ${circle.is_private ? "<span class='pill'>خاصة</span>" : ""}</h3>
    <p>${escapeHtml(circle.description || "لا يوجد وصف بعد")}</p><div class="entity-meta"><span>${circle.members_count || 0} عضو</span><span>${circle.posts_count || 0} منشور</span><span>${circle.my_membership === "pending" ? "طلب قيد المراجعة" : circle.my_role === "owner" ? "مالك" : circle.my_membership === "active" ? "عضو" : ""}</span></div></div>
  </a>`;
}

async function loadCircleLists(q = "") {
  const mine = document.getElementById("my-circles-list");
  const all = document.getElementById("circles-list");
  mine.innerHTML = '<div class="loading-spinner"></div>';
  all.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const [myCircles, publicCircles] = await Promise.all([
      Api.get("/api/circles/mine"), Api.get(`/api/circles?q=${encodeURIComponent(q)}&limit=50`),
    ]);
    mine.innerHTML = myCircles.length ? myCircles.map(circleCard).join("") : '<p class="feature-empty">لم تنضم إلى دوائر بعد.</p>';
    const myIds = new Set(myCircles.map((c) => c.id));
    const visible = publicCircles.filter((c) => !myIds.has(c.id));
    all.innerHTML = visible.length ? visible.map(circleCard).join("") : '<p class="feature-empty">لا توجد دوائر مطابقة. جرّب عبارة أخرى أو أنشئ دائرة جديدة.</p>';
    hydratePrivateMedia(mine);
    hydratePrivateMedia(all);
  } catch (err) {
    mine.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`;
    all.innerHTML = '<p class="feature-empty">تعذّر تحميل الدوائر.</p>';
  }
}

function renderCircleDetail(circle) {
  activeCircle = circle;
  const image = circleMedia(circle.cover_url || circle.image_url);
  const canPost = !circle.is_archived && (circle.my_membership === "active" || !circle.is_private);
  const membership = circle.my_membership;
  let action = "";
  if (!membership) action = `<button id="circle-join" class="btn btn-primary">${circle.is_private ? "طلب الانضمام" : "انضم إلى الدائرة"}</button>`;
  else if (membership === "pending") action = '<span class="feature-status warning">طلب الانضمام قيد المراجعة؛ ستظهر المنشورات بعد موافقة المشرف.</span>';
  else if (circle.my_role !== "owner") action = '<button id="circle-leave" class="btn btn-outline">مغادرة الدائرة</button>';
  document.getElementById("circle-detail").innerHTML = `
    <section class="card feature-panel">
      ${image ? circleImageMarkup(circle.cover_url || circle.image_url, "feature-banner", `غلاف ${circle.name}`) : ""}
      <div class="feature-inline"><h1>${escapeHtml(circle.name)}</h1><span class="pill">${circle.is_private ? "خاصة" : "عامة"}</span>${circle.is_archived ? '<span class="pill">مؤرشفة</span>' : ""}</div>
      <p class="feature-subtitle">${escapeHtml(circle.description || "لا يوجد وصف بعد")}</p>
      <div class="entity-meta"><span>${circle.members_count || 0} عضو</span><span>${circle.posts_count || 0} منشور</span><span>أُنشئت ${dateLabel(circle.created_at)}</span></div>
      <div class="feature-form-actions" style="margin-top:12px">${action}${circleCan("edit_circle") && !circle.is_archived ? `<button id="circle-archive" class="btn btn-outline">أرشفة الدائرة</button>` : ""}</div>
    </section>`;
  document.getElementById("circle-post-form").classList.toggle("hidden", !canPost);
  document.getElementById("circle-moderation").classList.toggle("hidden", !circle.can_moderate);
  document.getElementById("circle-posts").innerHTML = "";
  hydratePrivateMedia(document.getElementById("circle-detail"));
  if (document.getElementById("circle-join")) document.getElementById("circle-join").onclick = joinCircle;
  if (document.getElementById("circle-leave")) document.getElementById("circle-leave").onclick = leaveCircle;
  if (document.getElementById("circle-archive")) document.getElementById("circle-archive").onclick = archiveCircle;
  if (circle.can_moderate) loadCircleMembers();
  if (canPost) loadCirclePosts();
  else if (membership === "pending") document.getElementById("circle-posts").innerHTML = '<p class="feature-empty">المحتوى غير متاح قبل قبول طلبك.</p>';
  else if (circle.is_private) document.getElementById("circle-posts").innerHTML = '<p class="feature-empty">هذه دائرة خاصة. اطلب الانضمام لعرض محتواها.</p>';
}

async function loadCircleDetail() {
  document.getElementById("circle-list-view").classList.add("hidden");
  document.getElementById("circle-detail-view").classList.remove("hidden");
  const host = document.getElementById("circle-detail");
  host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const circle = await Api.get(`/api/circles/${circleId}`);
    renderCircleDetail(circle);
  } catch (err) {
    privateRequestMode = true;
    host.innerHTML = `<section class="card feature-panel"><h1>دائرة خاصة أو غير متاحة</h1><p class="feature-subtitle">إذا وصلتك دعوة لهذه الدائرة، أرسل طلب انضمام. لن يظهر محتواها قبل الموافقة.</p><button id="circle-join" class="btn btn-primary">طلب الانضمام</button><a class="btn btn-outline" href="circles.html">رجوع إلى الدوائر</a></section>`;
    document.getElementById("circle-join").onclick = joinCircle;
  }
}

async function joinCircle() {
  try {
    const result = await Api.post(`/api/circles/${circleId}/join`);
    showToast(result.message, "success");
    await loadCircleDetail();
  } catch (err) { showToast(err.message, "error"); }
}
async function leaveCircle() {
  if (!confirm("هل تريد مغادرة هذه الدائرة؟")) return;
  try { await Api.del(`/api/circles/${circleId}/leave`); showToast("غادرت الدائرة", "success"); location.href = "circles.html"; }
  catch (err) { showToast(err.message, "error"); }
}
async function archiveCircle() {
  if (!confirm("ستُؤرشف الدائرة وتبقى بياناتها محفوظة. متابعة؟")) return;
  try { await Api.put(`/api/circles/${circleId}/archive`); showToast("تمت أرشفة الدائرة", "success"); await loadCircleDetail(); }
  catch (err) { showToast(err.message, "error"); }
}

async function loadCircleMembers() {
  const host = document.getElementById("circle-pending-list");
  host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const [pending, members] = await Promise.all([
      Api.get(`/api/circles/${circleId}/members?status_filter=pending`),
      Api.get(`/api/circles/${circleId}/members?status_filter=active`),
    ]);
    const owner = activeCircle && activeCircle.my_role === "owner";
    const pendingHtml = pending.length ? pending.map((row) => `<div class="member-row"><div class="member-row-main"><strong>${escapeHtml(row.user.full_name)}</strong><div class="entity-meta">@${escapeHtml(row.user.username)} · طلب ${dateLabel(row.created_at)}</div></div>${circleCan("approve_members") || circleCan("remove_members") ? `<div class="member-row-actions">${circleCan("approve_members") ? `<button class="btn btn-primary btn-sm" data-approve="${row.user.id}">قبول</button>` : ""}${circleCan("remove_members") ? `<button class="btn btn-outline btn-sm" data-deny="${row.user.id}">رفض</button>` : ""}</div>` : ""}</div>`).join("") : '<p class="feature-empty">لا توجد طلبات معلّقة.</p>';
    const caps = ["approve_members", "remove_members", "manage_posts", "edit_circle", "pin_posts"];
    const selectable = members.filter((row) => row.role !== "owner");
    const memberOptions = selectable.map((row) => `<option value="${escapeHtml(row.user.id)}">${escapeHtml(row.user.full_name)} (@${escapeHtml(row.user.username)})</option>`).join("");
    const requestTools = !owner && selectable.length ? `<div class="dm-request-box"><h3 style="margin-top:16px">طلب مراسلة عضو</h3><select class="form-control" id="dm-recipient-select"><option value="">اختر عضوًا</option>${memberOptions}</select><button class="btn btn-primary btn-sm" id="dm-request-btn" type="button">إرسال طلب</button></div>` : "";
    const membersHtml = `<h3 style="margin-top:16px">الأعضاء</h3>` + members.map((row) => `<div class="member-row"><div class="member-row-main"><strong>${escapeHtml(row.user.full_name)}</strong><div class="entity-meta">@${escapeHtml(row.user.username)} · ${row.role === "owner" ? "مالك" : row.role === "moderator" ? "مشرف" : "عضو"}</div>${owner && row.role !== "owner" ? `<fieldset class="capability-box"><legend>صلاحيات المشرف</legend>${caps.map((cap) => `<label><input type="checkbox" data-cap-for="${row.user.id}" value="${cap}" ${Array.isArray(row.capabilities || row.moderator_capabilities) && (row.capabilities || row.moderator_capabilities).includes(cap) ? "checked" : ""}> ${cap}</label>`).join("")}<button class="btn btn-outline btn-sm" data-save-role="${row.user.id}" data-role-value="${row.role === "moderator" ? "moderator" : "member"}">حفظ الصلاحيات</button></fieldset>` : ""}</div>${(owner || circleCan("remove_members")) && row.role !== "owner" ? `<div class="member-row-actions">${owner ? "" : ""}${owner && row.role !== "owner" ? `<button class="btn btn-outline btn-sm" data-role="${row.user.id}" data-next-role="${row.role === "moderator" ? "member" : "moderator"}">${row.role === "moderator" ? "إزالة الإشراف" : "جعله مشرفًا"}</button>` : ""}${circleCan("remove_members") ? `<button class="btn btn-outline btn-sm" data-remove="${row.user.id}">إزالة</button>` : ""}</div>` : ""}</div>`).join("") + requestTools;
    host.innerHTML = `<div>${pendingHtml}</div>${membersHtml}`;
    host.querySelectorAll("[data-approve]").forEach((btn) => btn.onclick = async () => { if (!circleCan("approve_members")) return; try { await Api.post(`/api/circles/${circleId}/members/${btn.dataset.approve}/approve`); await loadCircleDetail(); } catch (err) { showToast(err.message,"error"); } });
    host.querySelectorAll("[data-deny],[data-remove]").forEach((btn) => btn.onclick = async () => { if (!circleCan("remove_members")) return; const uid = btn.dataset.deny || btn.dataset.remove; try { await Api.del(`/api/circles/${circleId}/members/${uid}`); await loadCircleDetail(); } catch (err) { showToast(err.message,"error"); } });
    host.querySelectorAll("[data-role]").forEach((btn) => btn.onclick = async () => { try { await Api.put(`/api/circles/${circleId}/members/${btn.dataset.role}/role`, { role: btn.dataset.nextRole }); await loadCircleDetail(); } catch (err) { showToast(err.message,"error"); } });
    host.querySelectorAll("[data-save-role]").forEach((btn) => btn.onclick = async () => { const capabilities = [...host.querySelectorAll(`[data-cap-for="${btn.dataset.saveRole}"]:checked`)].map((input) => input.value); try { await Api.put(`/api/circles/${circleId}/members/${btn.dataset.saveRole}/role`, { role: btn.dataset.roleValue, capabilities }); showToast("تم حفظ صلاحيات المشرف", "success"); await loadCircleDetail(); } catch (err) { showToast(err.message, "error"); } });
    const requestButton = host.querySelector("#dm-request-btn"); if (requestButton) requestButton.onclick = async () => { const recipient = host.querySelector("#dm-recipient-select").value; if (!recipient) return showToast("اختر عضوًا أولًا", "error"); try { await Api.post(`/api/circles/${circleId}/dm-requests/${encodeURIComponent(recipient)}`); showToast("تم إرسال طلب المراسلة", "success"); } catch (err) { showToast(err.message, "error"); } };
    if (owner) loadDmApprovals();
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}

async function loadDmApprovals() {
  const host = document.getElementById("circle-dm-approvals"); if (!host) return;
  if (activeCircle?.my_role !== "owner") return;
  try {
    const [requests, approvals] = await Promise.all([
      Api.get(`/api/circles/${circleId}/dm-requests?status_filter=pending`),
      Api.get(`/api/circles/${circleId}/dm-approvals`),
    ]);
    const pairName = (item) => `${item.requester?.full_name || item.requester_name || item.requester_username || item.requester_id} ↔ ${item.recipient?.full_name || item.recipient_name || item.recipient_username || item.recipient_id}`;
    host.innerHTML = `<h3 style="margin-top:16px">طلبات المراسلة المعلّقة</h3>${requests.length ? requests.map((item) => `<div class="member-row"><div class="member-row-main"><strong>${escapeHtml(pairName(item))}</strong></div><button class="btn btn-primary btn-sm" data-approve-pair="${escapeHtml(item.requester_id)}:${escapeHtml(item.recipient_id)}">موافقة</button></div>`).join("") : '<p class="feature-empty">لا توجد طلبات معلّقة.</p>'}<h3 style="margin-top:16px">موافقات الرسائل النشطة</h3>${approvals.length ? approvals.map((item) => `<div class="member-row"><div class="member-row-main"><strong>${escapeHtml(pairName(item))}</strong></div><button class="btn btn-outline btn-sm" data-revoke-pair="${escapeHtml(item.requester_id)}:${escapeHtml(item.recipient_id)}">سحب الموافقة</button></div>`).join("") : '<p class="feature-empty">لا توجد موافقات نشطة.</p>'}`;
    host.querySelectorAll("[data-approve-pair]").forEach((button) => button.onclick = async () => { const [requester_id, recipient_id] = button.dataset.approvePair.split(":"); try { await Api.post(`/api/circles/${circleId}/dm-approvals`, { requester_id: Number(requester_id), recipient_id: Number(recipient_id) }); showToast("تمت الموافقة على الزوج", "success"); loadDmApprovals(); } catch (err) { showToast(err.message, "error"); } });
    host.querySelectorAll("[data-revoke-pair]").forEach((button) => button.onclick = async () => { const [requester_id, recipient_id] = button.dataset.revokePair.split(":"); try { await Api.del(`/api/circles/${circleId}/dm-approvals/${encodeURIComponent(requester_id)}/${encodeURIComponent(recipient_id)}`); showToast("تم سحب الموافقة", "success"); loadDmApprovals(); } catch (err) { showToast(err.message, "error"); } });
  } catch (err) { host.innerHTML = `<p class="form-hint">تعذر تحميل طلبات المراسلة: ${escapeHtml(err.message)}</p>`; }
}

async function loadCirclePosts() {
  const host = document.getElementById("circle-posts");
  if (!host || !circleId) return;
  host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const posts = await Api.get(`/api/circles/${circleId}/posts?limit=50`);
    host.innerHTML = posts.length ? posts.map((post) => `${renderPostCard(post)}${circleCan("pin_posts") ? `<div class="feature-inline circle-pin-tools"><button class="btn btn-outline btn-sm" data-pin-post="${post.id}">${activeCircle.pinned_post_id === post.id ? "إلغاء التثبيت" : "تثبيت المنشور"}</button>${activeCircle.pinned_post_id === post.id ? '<span class="feature-status success">منشور مثبت</span>' : ""}</div>` : ""}`).join("") : '<p class="feature-empty">لا توجد منشورات بعد؛ ابدأ المشاركة.</p>';
    posts.forEach((post) => bindPostCardEvents(post));
    host.querySelectorAll("[data-pin-post]").forEach((btn) => btn.onclick = async () => { try { if (activeCircle.pinned_post_id === Number(btn.dataset.pinPost)) await Api.del(`/api/circles/${circleId}/pin`); else await Api.put(`/api/circles/${circleId}/pin/${btn.dataset.pinPost}`); await loadCircleDetail(); } catch (err) { showToast(err.message,"error"); } });
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
window.loadFeed = loadCirclePosts;

document.getElementById("circle-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  data.set("is_private", form.elements.is_private.checked ? "true" : "false");
  try { const circle = await Api.post("/api/circles", data, true); showToast("تم إنشاء الدائرة", "success"); location.href = `circles.html?id=${circle.id}`; }
  catch (err) { showToast(err.message, "error"); }
});

document.getElementById("circle-post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.media.files[0];
  const data = new FormData();
  data.set("content", form.elements.content.value);
  data.set("circle_id", String(circleId));
  if (file) data.set(file.type.startsWith("video/") ? "video" : "image", file);
  try { await Api.post("/api/posts", data, true); form.reset(); showToast("نُشر المنشور", "success"); await loadCircleDetail(); }
  catch (err) { showToast(err.message, "error"); }
});

let searchTimer;
document.getElementById("circle-search").addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadCircleLists(event.target.value), 250); });
document.getElementById("circle-search-btn").addEventListener("click", () => loadCircleLists(document.getElementById("circle-search").value));
if (circleId) loadCircleDetail(); else loadCircleLists();
