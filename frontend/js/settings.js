// منطق صفحة الإعدادات
let emailMfaChallenge = null;
let smsMfaChallenge = null;
let archiveState = "archived";
let privacySettingsLoaded = false;
let privacySaving = false;

document.addEventListener("DOMContentLoaded", () => {
  Layout.init("settings");
  loadCurrentData();
  setupMfaControls();
  loadMfaStatus();
  setupExpandedSettings();

  document.getElementById("avatar-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const profile = await Api.post("/api/users/me/avatar", formData, true);
      const user = Auth.getCurrentUser();
      user.avatar_url = profile.avatar_url;
      Auth.setCurrentUser(user);
      document.getElementById("settings-avatar").innerHTML = renderAvatar(user, "avatar-lg");
      showToast("تم تحديث الصورة الشخصية", "success");
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = document.getElementById("settings-fullname").value.trim();
    const bio = document.getElementById("settings-bio").value.trim();
    try {
      await Api.put("/api/users/me", { full_name, bio });
      const user = Auth.getCurrentUser();
      user.full_name = full_name;
      Auth.setCurrentUser(user);
      showToast("تم حفظ التغييرات", "success");
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const current_password = document.getElementById("current-password").value;
    const new_password = document.getElementById("new-password").value;
    const new_password2 = document.getElementById("new-password2").value;
    if (new_password !== new_password2) return showToast("كلمتا المرور الجديدتان غير متطابقتين", "error");
    try {
      await Api.put("/api/users/me/password", { current_password, new_password });
      showToast("تم تغيير كلمة المرور بنجاح", "success");
      e.target.reset();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("logout-btn").addEventListener("click", () => Auth.logout());
  document.getElementById("delete-account-btn").addEventListener("click", () => document.getElementById("delete-modal").classList.add("show"));
  document.getElementById("delete-cancel").addEventListener("click", () => document.getElementById("delete-modal").classList.remove("show"));
  document.getElementById("delete-confirm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("delete-password").value;
    try {
      await Api.del("/api/users/me", { password });
      Api.clearToken();
      window.location.href = "login.html";
    } catch (err) { showToast(err.message, "error"); }
  });
});

function setupExpandedSettings() {
  const privacyForm = document.getElementById("privacy-form");
  if (!privacyForm) return;
  loadAccountSettings(); loadFollowRequests(); loadArchive("posts", archiveState); loadActivity("all"); loadAccountStatus();
  privacyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!privacySettingsLoaded || privacySaving) return showToast("أعد تحميل الصفحة لتحميل إعداداتك الحالية قبل التعديل", "error");
    const body = {
      account_visibility: document.getElementById("account-visibility").value,
      comment_privacy: document.getElementById("comment-privacy").value,
      show_activity_status: document.getElementById("show-activity-status").value === "true",
      message_privacy: document.getElementById("message-privacy").value,
      content_visibility: document.getElementById("content-visibility").value
    };
    privacySaving = true; setPrivacyControlsDisabled(true);
    try { const state = await Api.patch("/api/account/settings", body); applyAccountSettings(state); showToast("تم حفظ إعدادات الخصوصية", "success"); loadFollowRequests(); } catch (err) { showToast(err.message, "error"); }
    finally { privacySaving = false; setPrivacyControlsDisabled(!privacySettingsLoaded); }
  });
  document.querySelectorAll("[data-archive-kind]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-archive-kind]").forEach((b) => b.classList.toggle("is-active", b === button)); loadArchive(button.dataset.archiveKind, archiveState); }));
  document.querySelectorAll("[data-archive-state]").forEach((button) => button.addEventListener("click", () => { archiveState = button.dataset.archiveState; document.querySelectorAll("[data-archive-state]").forEach((b) => b.classList.toggle("is-active", b === button)); loadArchive(document.querySelector("[data-archive-kind].is-active")?.dataset.archiveKind || "posts", archiveState); }));
  document.querySelectorAll("[data-activity-kind]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-activity-kind]").forEach((b) => b.classList.toggle("is-active", b === button)); loadActivity(button.dataset.activityKind); }));
}

function applyAccountSettings(state) {
  if (!state) return;
  const fields = ["account_visibility", "comment_privacy", "message_privacy", "content_visibility"];
  fields.forEach((key) => { const el = document.getElementById(key.replaceAll("_", "-")); if (el && state[key] != null) el.value = state[key]; });
  const activity = document.getElementById("show-activity-status");
  if (activity && state.show_activity_status != null) activity.value = String(Boolean(state.show_activity_status));
}
function setPrivacyControlsDisabled(disabled) {
  document.getElementById("privacy-form")?.querySelectorAll("select, button").forEach((control) => { control.disabled = disabled; });
}
async function loadAccountSettings() {
  privacySettingsLoaded = false; setPrivacyControlsDisabled(true);
  try { applyAccountSettings(await Api.get("/api/account/settings")); privacySettingsLoaded = true; } catch (err) { showToast(`تعذر تحميل الخصوصية: ${err.message}. لم تُغيَّر إعداداتك.`, "error"); }
  finally { setPrivacyControlsDisabled(!privacySettingsLoaded); }
}
async function loadFollowRequests() {
  const host = document.getElementById("follow-requests-list"); if (!host) return;
  host.innerHTML = '<span class="form-hint">جارٍ التحميل…</span>';
  try {
    const rows = await Api.get("/api/account/follow-requests?status=pending");
    host.innerHTML = rows.length ? rows.map((row) => { const user = row.requester || row.user || row; const id = Number(row.id); return `<article class="settings-list-item"><div><strong>${textValue(user.full_name || user.username || "مستخدم")}</strong><small>@${textValue(user.username || "")} · طلب متابعة</small></div><div><button class="btn btn-primary btn-sm" data-follow-request="${id}" data-follow-action="approve">موافقة</button><button class="btn btn-outline btn-sm" data-follow-request="${id}" data-follow-action="reject">رفض</button></div></article>`; }).join("") : '<p class="form-hint">لا توجد طلبات متابعة معلّقة.</p>';
    host.querySelectorAll("[data-follow-request]").forEach((button) => button.addEventListener("click", async () => { const id = encodeURIComponent(button.dataset.followRequest); const action = button.dataset.followAction; try { if (action === "approve") await Api.post(`/api/account/follow-requests/${id}/approve`); else await Api.post(`/api/account/follow-requests/${id}/reject`); showToast(action === "approve" ? "تم قبول الطلب" : "تم رفض الطلب", "success"); loadFollowRequests(); } catch (err) { showToast(err.message, "error"); } }));
  } catch (err) { host.innerHTML = `<p class="form-hint">${textValue(err.message)}</p>`; }
}
function settingsDate(value) { return value ? new Date(value).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" }) : ""; }
function textValue(value) { const div = document.createElement("div"); div.textContent = value == null ? "" : String(value); return div.innerHTML; }
async function loadArchive(kind, state = "archived") {
  const host = document.getElementById("archive-list"); host.innerHTML = '<span class="form-hint">جارٍ التحميل…</span>';
  try { const rows = await Api.get(`/api/account/archive?kind=${kind}${state === "active" ? "&include_active=true" : ""}`); const visible = rows.filter((row) => state === "active" ? !row.is_archived : row.is_archived !== false); host.innerHTML = visible.length ? visible.map((row) => `<article class="settings-list-item"><div><strong>${textValue(row.title || row.text || row.content || `${kind === "posts" ? "منشور" : "قصة"}${state === "active" ? "" : " مؤرشف"}`)}</strong><small>${textValue(settingsDate(row.archived_at || row.created_at))}</small>${(row.image_url || row.video_url) ? `<div class="archive-preview-actions">${row.image_url ? `<button type="button" class="btn btn-ghost btn-sm" data-preview-url="${textValue(row.image_url)}" data-preview-kind="image">عرض الصورة</button>` : ""}${row.video_url ? `<button type="button" class="btn btn-ghost btn-sm" data-preview-url="${textValue(row.video_url)}" data-preview-kind="video">عرض الفيديو</button>` : ""}</div><div data-preview-host="${textValue(row.id)}"></div>` : ""}</div>${state !== "active" && row.can_restore === false ? '<small class="form-hint">قصة منتهية؛ العرض بالأرشيف فقط.</small>' : `<button class="btn btn-outline btn-sm" data-archive-action="${textValue(row.id)}">${state === "active" ? "أرشفة" : "استعادة"}</button>`}</article>`).join("") : `<p class="form-hint">لا يوجد محتوى ${state === "active" ? "نشط" : "مؤرشف"}.</p>`; host.querySelectorAll("[data-archive-action]").forEach((button) => button.addEventListener("click", async () => { try { const id = encodeURIComponent(button.dataset.archiveAction); if (state === "active") await Api.post(`/api/account/archive/${kind}/${id}`); else await Api.del(`/api/account/archive/${kind}/${id}`); showToast(state === "active" ? "تمت أرشفة المحتوى" : "تمت استعادة المحتوى", "success"); loadArchive(kind, state); } catch (err) { showToast(err.message, "error"); } }));
    host.querySelectorAll("[data-preview-url]").forEach((button) => button.addEventListener("click", () => previewArchiveMedia(button)));
  } catch (err) { host.innerHTML = `<p class="form-hint">${textValue(err.message)}</p>`; }
}
async function loadActivity(kind) {
  const host = document.getElementById("activity-list"); host.innerHTML = '<span class="form-hint">جارٍ التحميل…</span>';
  try { const rows = await Api.get(`/api/account/activity?kind=${kind}&limit=50`); const labels = { like: "إعجاب", comment: "تعليق", settings_updated: "تحديث الإعدادات", profile_updated: "تحديث الملف الشخصي", password_changed: "تغيير كلمة المرور", archived: "أرشفة محتوى", restored: "استعادة محتوى" }; host.innerHTML = rows.length ? rows.map((row) => { const label = labels[row.type] || labels[row.kind] || "نشاط الحساب"; const detail = row.text || row.content || row.details || row.target_title || (row.target_id ? `المعرّف ${row.target_id}` : ""); return `<article class="settings-list-item"><div><strong>${textValue(label)}</strong><small>${textValue(detail)}${detail ? " · " : ""}${textValue(settingsDate(row.created_at || row.timestamp))}</small></div></article>`; }).join("") : '<p class="form-hint">لا يوجد نشاط في هذا القسم.</p>'; } catch (err) { host.innerHTML = `<p class="form-hint">${textValue(err.message)}</p>`; }
}
async function loadAccountStatus() {
  const host = document.getElementById("account-status");
  try { const state = await Api.get("/api/account/status"); host.innerHTML = `<div class="status-grid"><span>الحساب</span><strong>${state.is_active ? "نشط" : "غير نشط"}</strong><span>الحالة الأمنية</span><strong>${state.is_banned ? "محظور" : state.is_frozen ? "مجمّد" : "سليم"}</strong><span>التوثيق</span><strong>${state.is_verified ? "موثّق" : "غير موثّق"}</strong><span>تاريخ الإنشاء</span><strong>${textValue(settingsDate(state.created_at))}</strong></div>`; } catch (err) { host.innerHTML = `<span class="form-hint">${textValue(err.message)}</span>`; }
}

function setupMfaControls() {
  document.getElementById("mfa-email-enable").addEventListener("click", async () => {
    try {
      const result = await Api.post("/api/auth/mfa/email/start", {});
      emailMfaChallenge = result.challenge_id;
      document.getElementById("mfa-email-confirm").hidden = false;
      document.getElementById("mfa-email-code").focus();
      showToast(`أُرسل رمز التفعيل إلى ${result.target_hint}`, "success");
    } catch (err) { showToast(err.message, "error"); }
  });
  document.getElementById("mfa-email-confirm-btn").addEventListener("click", async () => {
    const code = document.getElementById("mfa-email-code").value.trim();
    if (!emailMfaChallenge || !/^\d{6}$/.test(code)) return showToast("أدخل رمز البريد المكوّن من 6 أرقام", "error");
    try {
      await Api.post("/api/auth/mfa/email/confirm", { challenge_id: emailMfaChallenge, code });
      emailMfaChallenge = null;
      document.getElementById("mfa-email-confirm").hidden = true;
      document.getElementById("mfa-email-code").value = "";
      showToast("تم تفعيل التحقق بالبريد", "success");
      await loadMfaStatus();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("mfa-sms-enable").addEventListener("click", () => {
    document.getElementById("mfa-sms-setup").hidden = false;
    document.getElementById("mfa-phone").focus();
  });
  document.getElementById("mfa-sms-send").addEventListener("click", async () => {
    const phone_number = document.getElementById("mfa-phone").value.trim();
    try {
      const result = await Api.post("/api/auth/mfa/sms/start", { phone_number });
      smsMfaChallenge = result.challenge_id;
      document.getElementById("mfa-sms-confirm").hidden = false;
      document.getElementById("mfa-sms-code").focus();
      showToast(`أُرسل رمز التحقق إلى ${result.target_hint}`, "success");
    } catch (err) { showToast(err.message, "error"); }
  });
  document.getElementById("mfa-sms-confirm-btn").addEventListener("click", async () => {
    const code = document.getElementById("mfa-sms-code").value.trim();
    if (!smsMfaChallenge || !/^\d{6}$/.test(code)) return showToast("أدخل رمز SMS المكوّن من 6 أرقام", "error");
    try {
      await Api.post("/api/auth/mfa/sms/confirm", { challenge_id: smsMfaChallenge, code });
      smsMfaChallenge = null;
      document.getElementById("mfa-sms-setup").hidden = true;
      document.getElementById("mfa-sms-code").value = "";
      showToast("تم التحقق من الهاتف وتفعيل SMS", "success");
      await loadMfaStatus();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("mfa-totp-enable").addEventListener("click", async () => {
    try {
      const setup = await Api.post("/api/auth/mfa/totp/setup", {});
      document.getElementById("mfa-totp-secret").value = setup.secret;
      document.getElementById("mfa-totp-setup").hidden = false;
      document.getElementById("mfa-totp-code").focus();
      showToast("أضف المفتاح إلى تطبيق المصادقة ثم أدخل رمزه", "success");
    } catch (err) { showToast(err.message, "error"); }
  });
  document.getElementById("mfa-totp-confirm-btn").addEventListener("click", async () => {
    const code = document.getElementById("mfa-totp-code").value.trim();
    if (!/^\d{6}$/.test(code)) return showToast("أدخل رمز التطبيق المكوّن من 6 أرقام", "error");
    try {
      await Api.post("/api/auth/mfa/totp/confirm", { code });
      document.getElementById("mfa-totp-secret").value = "";
      document.getElementById("mfa-totp-code").value = "";
      document.getElementById("mfa-totp-setup").hidden = true;
      showToast("تم تفعيل تطبيق المصادقة", "success");
      await loadMfaStatus();
    } catch (err) { showToast(err.message, "error"); }
  });

  ["email", "sms", "totp"].forEach((method) => {
    document.getElementById(`mfa-${method}-disable`).addEventListener("click", async () => {
      const password = window.prompt("أدخل كلمة المرور الحالية لتأكيد إيقاف التحقق:");
      if (password === null) return;
      const payload = { method, password };
      if (method === "totp") {
        const code = window.prompt("أدخل رمز تطبيق المصادقة الحالي:");
        if (code === null) return;
        payload.code = code.trim();
      }
      try {
        await Api.post("/api/auth/mfa/disable", payload);
        showToast("تم إيقاف وسيلة التحقق", "success");
        await loadMfaStatus();
      } catch (err) { showToast(err.message, "error"); }
    });
  });
}

async function loadMfaStatus() {
  const note = document.getElementById("mfa-provider-note");
  try {
    const state = await Api.get("/api/auth/mfa");
    const methods = [
      { key: "totp", enabled: state.totp_enabled, ready: true, hint: "" },
      { key: "email", enabled: state.email_enabled, ready: state.email_delivery_ready, hint: state.email_hint },
      { key: "sms", enabled: state.sms_enabled, ready: state.sms_delivery_ready, hint: state.phone_hint },
    ];
    methods.forEach(({ key, enabled, ready, hint }) => {
      const status = document.getElementById(`mfa-${key}-status`);
      const enable = document.getElementById(`mfa-${key}-enable`);
      const disable = document.getElementById(`mfa-${key}-disable`);
      enable.hidden = !!enabled;
      enable.disabled = !ready;
      disable.hidden = !enabled;
      status.textContent = enabled ? `مفعّل${hint ? ` · ${hint}` : ""}` : ready ? "غير مفعّل" : "يحتاج إعداد مزوّد الإرسال";
    });
    note.textContent = `التحقق بخطوتين اختياري. الموصى به والأوفر: تطبيق مصادقة مجاني (TOTP). ${state.email_delivery_ready ? "البريد متاح عبر Brevo." : "البريد يحتاج إعداد Brevo."} ${state.sms_delivery_ready ? "SMS متاح عبر Twilio Verify وقد تترتب عليه رسوم." : "SMS يحتاج إعداد Twilio Verify وقد تترتب عليه رسوم."}`;
  } catch (err) {
    note.textContent = `تعذر قراءة حالة التحقق: ${err.message}`;
  }
}

function loadCurrentData() {
  const user = Auth.getCurrentUser();
  if (!user) return;
  document.getElementById("settings-avatar").innerHTML = renderAvatar(user, "avatar-lg");
  document.getElementById("settings-fullname").value = user.full_name || "";
  Api.get(`/api/users/${encodeURIComponent(user.username)}`).then((profile) => {
    document.getElementById("settings-bio").value = profile.bio || "";
  }).catch(() => undefined);
}

async function previewArchiveMedia(button) {
  const raw = button.dataset.previewUrl || "";
  let url; try { url = new URL(raw, window.location.origin); } catch (_) { return showToast("رابط الوسيط غير صالح", "error"); }
  if (url.origin !== window.location.origin || !/^\/api\/account\/archive\/(posts|stories)\/\d+\/media\/(image|video)$/.test(url.pathname)) return showToast("رابط الوسيط غير مسموح", "error");
  try { const response = await fetch(url.pathname, { headers: Api.getToken() ? { Authorization: `Bearer ${Api.getToken()}` } : {} }); if (!response.ok) throw new Error("تعذر تحميل الوسيط"); const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob); const host = button.closest("article").querySelector("[data-preview-host]"); const tag = button.dataset.previewKind === "video" ? "video" : "img"; host.innerHTML = `<${tag} controls ${tag === "img" ? "alt=\"معاينة الوسيط المؤرشف\"" : "preload=\"metadata\""} style=\"max-width:100%;max-height:260px;margin-top:8px;border-radius:8px\"></${tag}>`; const media = host.firstElementChild; media.src = objectUrl; media.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true }); media.addEventListener("ended", () => URL.revokeObjectURL(objectUrl), { once: true }); } catch (err) { showToast(err.message, "error"); }
}
