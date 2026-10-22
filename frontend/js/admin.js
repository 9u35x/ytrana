/* لوحة الإدارة: صلاحية backend access فقط، دون الاعتماد على is_admin في الواجهة. */
const ADMIN_LIMIT = 12;
const REPORT_TYPES = ["user", "post", "comment", "reel", "story", "message"];
const REPORT_CATEGORIES = ["spam", "harassment", "hate", "violence", "sexual", "impersonation", "scam", "privacy", "copyright", "other"];
const LABELS = { user: "مستخدم", post: "منشور", comment: "تعليق", reel: "Reel", story: "قصة", message: "رسالة", spam: "رسائل مزعجة", harassment: "مضايقة", hate: "كراهية", violence: "عنف", sexual: "محتوى جنسي", impersonation: "انتحال", scam: "احتيال", privacy: "خصوصية", copyright: "حقوق نشر", other: "أخرى" };
let adminTab = "users", userPage = 0, userSearch = "", reportPage = 0;
let reportFilters = { status_filter: "pending", target_type: "", category: "" };
let userLoadSequence = 0, reportLoadSequence = 0;
const reportPreviewUrls = new Set();

function adminEsc(value) { return typeof escapeHtml === "function" ? escapeHtml(value == null ? "" : String(value)) : String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function asList(data) { if (Array.isArray(data)) return { items: data, total: null }; return { items: data && (data.items || data.results || data.data) || [], total: data && (data.total ?? data.count ?? null) }; }
function qs(params) { return Object.entries(params).filter(([, v]) => v !== "" && v != null && v !== "all").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
function statusBadge(label, cls = "") { return `<span class="admin-badge ${cls}">${adminEsc(label)}</span>`; }
function notePrompt(label = "ملاحظة (مطلوبة لهذا الإجراء):") { const note = prompt(label, ""); return note === null ? null : note.trim(); }
function daysPrompt() { const raw = prompt("عدد الأيام (اتركه فارغًا لمدة غير محددة):", ""); if (raw === null) return null; if (!raw.trim()) return undefined; const days = Number(raw); if (!Number.isInteger(days) || days < 1) { showToast("أدخل عدد أيام صحيحًا", "error"); return null; } return days; }
function confirmAction(message) { return window.confirm(message); }
function isClosedReport(report) { return String(report.status || "").toLowerCase() !== "pending"; }

function openVerificationDialog(id, trigger) {
  if (document.getElementById("verification-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "verification-dialog"; dialog.className = "verification-dialog"; dialog.dir = "rtl";
  dialog.setAttribute("aria-labelledby", "verification-title");
  dialog.innerHTML = `<form class="verification-form"><div class="verification-heading"><span class="verified-badge" aria-hidden="true"></span><div><h2 id="verification-title">توثيق الحساب</h2><p>إدارة الشارة الزرقاء · حساب #${adminEsc(decodeURIComponent(id))}</p></div></div><fieldset class="verification-options"><legend>اختر إجراء التوثيق</legend>${[["permanent", "توثيق دائم", "شارة زرقاء دون تاريخ انتهاء"], ["temporary", "توثيق مؤقت", "شارة زرقاء لمدة تحددها بالأيام"], ["revoke", "إزالة التوثيق", "سحب الشارة الزرقاء من الحساب"]].map(([value, title, help], i) => `<label class="verification-choice ${value === "revoke" ? "verification-choice-danger" : ""}"><input type="radio" name="mode" value="${value}" ${i === 0 ? "checked" : ""}><span><strong>${title}</strong><small>${help}</small></span></label>`).join("")}</fieldset><label class="verification-field" id="verification-days-field" hidden>مدة التوثيق بالأيام<input class="form-control" name="days" type="number" min="1" max="3650" step="1" inputmode="numeric" placeholder="مثال: 30" disabled></label><label class="verification-field">ملاحظة التوثيق (مطلوبة)<textarea class="form-control" name="note" required maxlength="1000" placeholder="اكتب سبب منح التوثيق أو إزالته"></textarea></label><p class="verification-help">لن يتم أي تغيير إلا بعد حفظ القرار. تبقى صلاحيات الإدارة كما هي.</p><p class="verification-error" role="alert"></p><div class="verification-footer"><button type="button" class="btn btn-outline" data-cancel>إلغاء</button><button class="btn verification-submit" type="submit">حفظ التوثيق</button></div></form>`;
  const form = dialog.querySelector("form"), days = form.elements.days, note = form.elements.note;
  const error = dialog.querySelector(".verification-error"), submit = form.querySelector('[type="submit"]');
  let busy = false;
  form.addEventListener("change", () => {
    const temporary = form.elements.mode.value === "temporary";
    document.getElementById("verification-days-field").hidden = !temporary;
    days.disabled = !temporary; days.required = temporary;
    submit.textContent = form.elements.mode.value === "revoke" ? "إزالة التوثيق" : "حفظ التوثيق";
  });
  dialog.querySelector("[data-cancel]").addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { dialog.remove(); if (trigger && trigger.isConnected) trigger.focus(); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const mode = form.elements.mode.value, duration = Number(days.value), text = note.value.trim();
    if (!text) { error.textContent = "ملاحظة التوثيق مطلوبة"; note.focus(); return; }
    if (mode === "temporary" && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) { error.textContent = "أدخل عدد أيام صحيحًا من 1 إلى 3650"; days.focus(); return; }
    busy = true; error.textContent = "";
    const controls = [...form.querySelectorAll("button,input,textarea")]; controls.forEach(control => control.disabled = true);
    submit.textContent = "جارٍ الحفظ…";
    try {
      await Api.put(`/api/admin/users/${id}/verification`, { mode, ...(mode === "temporary" ? { days: duration } : {}), note: text });
      dialog.close(); showToast("تم تحديث توثيق الحساب", "success"); await loadAdminUsers();
    } catch (e) {
      busy = false; controls.forEach(control => control.disabled = false); days.disabled = mode !== "temporary";
      submit.textContent = mode === "revoke" ? "إزالة التوثيق" : "حفظ التوثيق";
      error.textContent = e.message || "تعذر حفظ التوثيق، حاول مجددًا";
    }
  });
  document.body.appendChild(dialog); dialog.showModal();
}

window.addEventListener("DOMContentLoaded", async () => {
  Auth.requireAuth(); Theme.init();
  try { const access = await Api.get("/api/admin/access"); if (!access || access.allowed !== true) throw new Error("غير مصرح لك بالدخول إلى لوحة الإدارة"); }
  catch (e) { document.body.innerHTML = `<div class="empty-state" style="margin-top:60px"><p>${adminEsc(e.message)}</p><a class="btn btn-primary mt-4" href="index.html">العودة للرئيسية</a></div>`; return; }
  document.getElementById("admin-tab-users").addEventListener("click", () => switchAdminTab("users"));
  document.getElementById("admin-tab-reports").addEventListener("click", () => switchAdminTab("reports"));
  switchAdminTab("users");
});
function switchAdminTab(tab) { adminTab = tab; document.getElementById("admin-tab-users").classList.toggle("active", tab === "users"); document.getElementById("admin-tab-reports").classList.toggle("active", tab === "reports"); return tab === "users" ? loadAdminUsers() : loadAdminReports(); }

async function loadAdminUsers() {
  const sequence = ++userLoadSequence;
  const box = document.getElementById("admin-content");
  box.innerHTML = `<div class="admin-toolbar"><h2>المستخدمون</h2><span class="admin-status" id="admin-status"></span></div><form class="admin-filters" id="user-filter"><input class="form-control" id="user-search" placeholder="بحث بالاسم أو المعرّف" value="${adminEsc(userSearch)}"><button class="btn btn-primary" type="submit">بحث</button></form><div id="user-list"><div class="loading-spinner"></div></div><div class="admin-pagination" id="user-pagination"></div>`;
  document.getElementById("user-filter").addEventListener("submit", e => { e.preventDefault(); userSearch = document.getElementById("user-search").value.trim(); userPage = 0; loadAdminUsers(); });
  try { const data = asList(await Api.get(`/api/admin/users?${qs({ search: userSearch, skip: userPage * ADMIN_LIMIT, limit: ADMIN_LIMIT })}`)); if (sequence === userLoadSequence) renderUsers(data); }
  catch (e) { if (sequence === userLoadSequence) document.getElementById("user-list").innerHTML = `<div class="admin-empty">${adminEsc(e.message)}</div>`; }
}
function renderUsers(data) {
  const list = document.getElementById("user-list");
  list.innerHTML = data.items.length ? `<div class="admin-grid">${data.items.map(u => { const verified = u.is_verified ? (u.verification_expires_at ? `موثق حتى ${u.verification_expires_at}` : "موثق دائمًا") : "غير موثق"; const frozen = u.is_frozen ? `مجمد${u.frozen_until ? ` حتى ${u.frozen_until}` : ""}` : "غير مجمد"; return `<article class="card admin-card"><div class="admin-user">${typeof renderAvatar === "function" ? renderAvatar(u, "avatar-md") : ""}<div class="admin-user-main"><div class="admin-user-name">${adminEsc(u.full_name || u.display_name || "مستخدم")}${u.is_verified ? '<span class="verified-badge" role="img" title="حساب موثّق" aria-label="حساب موثّق"></span>' : ""}</div><div class="admin-muted">${adminEsc(u.username ? `@${u.username}` : `ID: ${u.id}`)}</div><div class="admin-badges">${statusBadge(verified, u.is_verified ? "ok" : "")}${statusBadge(frozen, u.is_frozen ? "danger" : "")}${u.is_banned ? statusBadge("محظور", "danger") : ""}</div></div></div><div class="admin-actions" style="margin-top:12px"><button class="btn btn-outline btn-sm" data-user-action="verification" data-id="${adminEsc(u.id)}">التوثيق</button><button class="btn btn-outline btn-sm" data-user-action="freeze" data-id="${adminEsc(u.id)}" data-active="${!!u.is_frozen}">${u.is_frozen ? "إلغاء التجميد" : "تجميد"}</button><button class="btn ${u.is_banned ? "btn-outline" : "btn-danger"} btn-sm" data-user-action="ban" data-id="${adminEsc(u.id)}" data-active="${!!u.is_banned}">${u.is_banned ? "إلغاء الحظر" : "حظر"}</button></div></article>`; }).join("")}</div>` : '<div class="admin-empty">لا توجد نتائج</div>';
  list.querySelectorAll("[data-user-action]").forEach(b => b.addEventListener("click", () => handleUserAction(b)));
  const totalPages = data.total == null ? (data.items.length === ADMIN_LIMIT ? userPage + 2 : userPage + 1) : Math.max(1, Math.ceil(data.total / ADMIN_LIMIT));
  document.getElementById("user-pagination").innerHTML = `<button class="btn btn-outline btn-sm" ${userPage === 0 ? "disabled" : ""} data-page="prev">السابق</button><span class="admin-muted">صفحة ${userPage + 1}${data.total != null ? ` من ${totalPages}` : ""}</span><button class="btn btn-outline btn-sm" ${userPage + 1 >= totalPages ? "disabled" : ""} data-page="next">التالي</button>`;
  document.querySelectorAll("#user-pagination [data-page]").forEach(b => b.addEventListener("click", () => { userPage += b.dataset.page === "next" ? 1 : -1; loadAdminUsers(); }));
}
async function handleUserAction(btn) {
  const id = encodeURIComponent(btn.dataset.id), action = btn.dataset.userAction, active = btn.dataset.active === "true";
  if (action === "verification") { openVerificationDialog(id, btn); return; }
  try {
    if (action === "ban") { if (!confirmAction(active ? "إلغاء حظر هذا الحساب؟" : "حظر هذا الحساب؟ هذا إجراء عقابي.")) return; const note = notePrompt(active ? "ملاحظة (اختيارية):" : "ملاحظة الحظر (اختيارية):"); if (note === null) return; await Api.put(`/api/admin/users/${id}/${active ? "unban" : "ban"}`, note ? { note } : undefined); }
    if (action === "freeze") { if (active) { if (!confirmAction("إلغاء تجميد هذا الحساب؟")) return; const note = notePrompt("ملاحظة (اختيارية):"); if (note === null) return; await Api.put(`/api/admin/users/${id}/unfreeze`, note ? { note } : undefined); } else { if (!confirmAction("تجميد هذا الحساب؟ هذا إجراء عقابي.")) return; const days = daysPrompt(); if (days === null) return; const note = notePrompt(); if (note === null || !note) { showToast("ملاحظة التجميد مطلوبة", "error"); return; } await Api.put(`/api/admin/users/${id}/freeze`, { ...(days === undefined ? { days: null } : { days }), note }); } }
    showToast("تم تحديث الحساب", "success"); await loadAdminUsers();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadAdminReports() {
  const sequence = ++reportLoadSequence;
  const box = document.getElementById("admin-content");
  box.innerHTML = `<div class="admin-toolbar"><h2>البلاغات</h2></div><form class="admin-filters" id="report-filter"><label class="admin-filter-label">حالة البلاغ<select class="form-control" id="report-status"><option value="pending">قيد الانتظار</option><option value="reviewed">تمت المراجعة</option><option value="dismissed">مرفوض</option><option value="all">الكل</option></select></label><label class="admin-filter-label">نوع المحتوى<select class="form-control" id="report-type"><option value="">كل الأنواع</option>${REPORT_TYPES.map(x => `<option value="${x}">${LABELS[x]}</option>`).join("")}</select></label><label class="admin-filter-label">سبب البلاغ<select class="form-control" id="report-category"><option value="">كل الأسباب</option>${REPORT_CATEGORIES.map(x => `<option value="${x}">${LABELS[x]}</option>`).join("")}</select></label><button class="btn btn-primary" type="submit">تطبيق</button></form><div id="report-list"><div class="loading-spinner"></div></div><div class="admin-pagination" id="report-pagination"></div>`;
  document.getElementById("report-status").value = reportFilters.status_filter || "all";
  document.getElementById("report-type").value = reportFilters.target_type;
  document.getElementById("report-category").value = reportFilters.category;
  document.getElementById("report-filter").addEventListener("submit", e => { e.preventDefault(); reportFilters = { status_filter: document.getElementById("report-status").value === "all" ? "" : document.getElementById("report-status").value, target_type: document.getElementById("report-type").value, category: document.getElementById("report-category").value }; reportPage = 0; loadAdminReports(); });
  try { const data = asList(await Api.get(`/api/admin/reports?${qs({ ...reportFilters, skip: reportPage * ADMIN_LIMIT, limit: ADMIN_LIMIT })}`)); if (sequence === reportLoadSequence) await renderReports(data, sequence); }
  catch (e) { if (sequence === reportLoadSequence) document.getElementById("report-list").innerHTML = `<div class="admin-empty">${adminEsc(e.message)}</div>`; }
}
function clearReportPreviewUrls() { reportPreviewUrls.forEach((url) => URL.revokeObjectURL(url)); reportPreviewUrls.clear(); }
function addReportMediaPreview(node, media) {
  if (!node || !Array.isArray(media) || !media.length) return;
  const button = document.createElement("button"); button.type = "button"; button.className = "btn btn-outline btn-sm"; button.textContent = "عرض الوسائط المرفقة";
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true; button.textContent = "جارٍ تحميل الوسائط…";
    try {
      const items = media.filter((m) => m && (m.kind === "image" || m.kind === "video") && typeof m.url === "string" && m.url.startsWith("/api/admin/reports/"));
      for (const item of items) {
        const response = await fetch(`${YTRANA_CONFIG.API_BASE}${item.url}`, { headers: Api.getToken() ? { Authorization: `Bearer ${Api.getToken()}` } : {} });
        if (!response.ok) throw new Error("تعذر تحميل الوسيط");
        const objectUrl = URL.createObjectURL(await response.blob()); reportPreviewUrls.add(objectUrl);
        const mediaNode = document.createElement(item.kind === "video" ? "video" : "img"); mediaNode.src = objectUrl; mediaNode.className = "admin-report-media"; mediaNode.style.cssText = "display:block;max-width:100%;max-height:280px;margin-top:8px;border-radius:8px"; if (item.kind === "video") { mediaNode.controls = true; mediaNode.playsInline = true; } else mediaNode.alt = "وسيط البلاغ"; node.appendChild(mediaNode);
      }
      button.remove();
    } catch (error) { button.disabled = false; button.textContent = "عرض الوسائط المرفقة"; showToast(error.message, "error"); }
  });
  node.appendChild(button);
}
function renderReportPagination(data) { const totalPages = data.total == null ? (data.items.length === ADMIN_LIMIT ? reportPage + 2 : reportPage + 1) : Math.max(1, Math.ceil(data.total / ADMIN_LIMIT)); const el = document.getElementById("report-pagination"); if (!el) return; el.innerHTML = `<button class="btn btn-outline btn-sm" ${reportPage === 0 ? "disabled" : ""} data-page="prev">السابق</button><span class="admin-muted">صفحة ${reportPage + 1}${data.total != null ? ` من ${totalPages}` : ""}</span><button class="btn btn-outline btn-sm" ${reportPage + 1 >= totalPages ? "disabled" : ""} data-page="next">التالي</button>`; el.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => { reportPage += b.dataset.page === "next" ? 1 : -1; loadAdminReports(); })); }
async function renderReports(data, sequence) {
  clearReportPreviewUrls();
  const list = document.getElementById("report-list");
  renderReportPagination(data);
  if (!data.items.length) { list.innerHTML = '<div class="admin-empty">لا توجد بلاغات</div>'; return; }
  list.innerHTML = data.items.map(r => { const closed = isClosedReport(r); return `<article class="card admin-card admin-report-card ${closed ? "is-closed" : ""}" data-report-id="${adminEsc(r.id)}"><div class="admin-report-top"><span class="admin-muted">بلاغ #${adminEsc(r.id)} · ${adminEsc(r.created_at ? timeAgo(r.created_at) : "")}</span><span class="admin-report-state ${closed ? "" : "pending"}">${adminEsc(({pending:"قيد الانتظار",reviewed:"تمت المراجعة",dismissed:"مرفوض"})[r.status] || r.status)}</span></div><div class="admin-report-title"><b>${adminEsc(LABELS[r.target_type] || r.target_type || "هدف")}</b> · ${adminEsc(LABELS[r.category] || r.category || "سبب غير محدد")}</div>${r.reason ? `<div class="admin-preview">${adminEsc(r.reason)}</div>` : ""}<div class="admin-muted">الحالة: ${adminEsc(r.resolution || r.status || "قيد الانتظار")} ${r.reviewer_id ? `· المراجع: ${adminEsc(r.reviewer_id)}` : ""} ${r.reviewed_at ? `· ${adminEsc(r.reviewed_at)}` : ""}</div>${r.review_note ? `<div class="admin-preview"><strong>ملاحظة المراجعة:</strong> ${adminEsc(r.review_note)}</div>` : ""}<div class="admin-preview" id="target-${adminEsc(r.id)}">جاري تحميل ملخص الهدف…</div><label class="admin-review-label" for="review-note-${adminEsc(r.id)}">ملاحظة المراجعة</label><textarea id="review-note-${adminEsc(r.id)}" class="form-control admin-note" data-note-for="${adminEsc(r.id)}" maxlength="500" placeholder="ملاحظة المراجعة${closed ? " (للقراءة فقط؛ البلاغ مغلق)" : ""}" ${closed ? "disabled" : ""}></textarea><div class="admin-actions" style="margin-top:10px"><button class="btn btn-outline btn-sm" data-report-action="review" data-id="${adminEsc(r.id)}" ${closed ? "disabled" : ""}>مراجعة</button><button class="btn btn-outline btn-sm" data-report-action="dismiss" data-id="${adminEsc(r.id)}" ${closed ? "disabled" : ""}>رفض</button><button class="btn btn-danger btn-sm" data-report-action="delete_content" data-id="${adminEsc(r.id)}" ${closed ? "disabled" : ""}>حذف المحتوى</button><button class="btn btn-danger btn-sm" data-report-action="ban_user" data-id="${adminEsc(r.id)}" ${closed ? "disabled" : ""}>حظر المستخدم</button><button class="btn btn-danger btn-sm" data-report-action="freeze_user" data-id="${adminEsc(r.id)}" ${closed ? "disabled" : ""}>تجميد المستخدم</button></div></article>`; }).join("");
  list.querySelectorAll("[data-report-action]").forEach(b => b.addEventListener("click", () => resolveReport(b)));
  await Promise.all(data.items.map(async r => { try { const t = await Api.get(`/api/admin/reports/${encodeURIComponent(r.id)}/target`); if (sequence !== reportLoadSequence) return; const node = document.getElementById(`target-${r.id}`); if (node) { node.textContent = t.exists ? `${LABELS[t.target_type] || t.target_type || "هدف"} #${t.target_id}${t.owner_id ? ` · مالك: ${t.owner_id}` : ""}${t.summary ? `\n${t.summary}` : ""}` : `الهدف غير موجود — الملخص السابق: ${t.summary || "لا يتوفر ملخص"}`; addReportMediaPreview(node, t.media); } } catch (_) { const node = document.getElementById(`target-${r.id}`); if (node && sequence === reportLoadSequence) node.textContent = "تعذر تحميل ملخص الهدف"; } }));
}
async function resolveReport(btn) { if (btn.disabled) return; const action = btn.dataset.reportAction; if (["delete_content", "ban_user", "freeze_user"].includes(action) && !confirmAction("هذا إجراء عقابي وقد يؤثر على محتوى أو حساب. هل تريد المتابعة؟")) return; const noteEl = document.querySelector(`[data-note-for="${CSS.escape(btn.dataset.id)}"]`); let note = noteEl ? noteEl.value.trim() : ""; if (["delete_content", "ban_user", "freeze_user"].includes(action) && !note) { note = notePrompt(); if (note === null) return; } if (["delete_content", "ban_user", "freeze_user"].includes(action) && !note) { showToast("ملاحظة الإجراء مطلوبة", "error"); return; } let days; if (action === "freeze_user") { days = daysPrompt(); if (days === null) return; } try { btn.disabled = true; await Api.put(`/api/admin/reports/${encodeURIComponent(btn.dataset.id)}/resolve`, { action, note, ...(action === "freeze_user" ? { days: days === undefined ? null : days } : {}) }); showToast("تم تحديث البلاغ", "success"); await loadAdminReports(); } catch (e) { btn.disabled = false; showToast(e.message, "error"); } }
