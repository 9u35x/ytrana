/* Interactive profile levels: API data is the only source of truth. */
(function (root) {
  "use strict";
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[ch]));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString("ar") : "—";
  const safePercent = (value) => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
  const safeColor = (value) => /^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? String(value) : "#8b7cf6";
  const requestTokens = typeof WeakMap !== "undefined" ? new WeakMap() : new Map();

  function levelByNumber(data, selected) {
    return data.levels.find((item) => Number(item.level) === Number(selected)) || data.levels[0];
  }
  function selectedProgress(data, level) {
    const followers = Number(data.followers_count);
    const days = Number(data.active_days);
    const requiredFollowers = Number(level.required_followers);
    const requiredDays = Number(level.required_active_days);
    const followerRatio = requiredFollowers > 0 && Number.isFinite(followers) ? followers / requiredFollowers : (requiredFollowers === 0 ? 1 : 0);
    const dayRatio = requiredDays > 0 && Number.isFinite(days) ? days / requiredDays : (requiredDays === 0 ? 1 : 0);
    return safePercent(Math.min(followerRatio, dayRatio) * 100);
  }
  function detailMarkup(data, level) {
    const earned = level.earned === true;
    const progress = selectedProgress(data, level);
    return `<div class="stars-detail-heading"><div class="stars-crystal" style="--star-color:${safeColor(level.color)}" aria-hidden="true">${esc(level.icon || (Number(level.level) === 10 ? "◆" : "★"))}</div><div><h4>${esc(level.name)}</h4><p>المستوى ${esc(level.level)} · <strong class="stars-detail-status">${earned ? "مكتسب" : "مقفل"}</strong></p></div></div>
      <div class="stars-detail-grid"><div><span>المتابعون الحاليون</span><b>${number(data.followers_count)}</b><small>المطلوب: ${number(level.required_followers)}</small></div><div><span>أيام النشاط الحالية</span><b>${number(data.active_days)}</b><small>المطلوب: ${number(level.required_active_days)}</small></div></div>
      <div class="stars-target-label"><span>التقدم نحو الهدف المحدد</span><b>${progress}%</b></div><div class="stars-progress stars-detail-progress" role="progressbar" aria-label="التقدم نحو الهدف المحدد للمستوى ${esc(level.level)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
      <p class="stars-detail-note">${earned ? "هذا المستوى مكتسب حاليًا." : "هذه معاينة للمتطلبات؛ لم يُفتح المستوى."}</p>`;
  }

  function bindCard(card, data) {
    if (!card || !card.querySelectorAll) return;
    const buttons = card.querySelectorAll(".stars-level-button");
    const detail = card.querySelector(".stars-detail");
    if (!detail || !buttons || !buttons.length) return;
    buttons.forEach((button) => button.addEventListener("click", () => {
      const level = levelByNumber(data, button.getAttribute("data-level"));
      buttons.forEach((item) => { item.setAttribute("aria-pressed", item === button ? "true" : "false"); item.classList.toggle("is-selected", item === button); });
      detail.innerHTML = detailMarkup(data, level);
      const reward = card.querySelector(".stars-reward");
      if (reward) reward.innerHTML = rewardMarkup(level);
    }));
  }

  function rewardMarkup(level) {
    const proposal = Number(level.proposed_priority_bonus_percent);
    const bonus = Number.isFinite(proposal) ? `: ${esc(proposal)}%` : "";
    return `<strong>أولوية توصية مقترحة للمستوى ${esc(level.level)}${bonus}</strong><p class="stars-proposal">غير مطبقة حاليًا — لا توجد مكافأة وصول مطبقة ولا ضمان للمشاهدات.</p>`;
  }

  function renderStarsCard(data) {
    if (!data || !Array.isArray(data.levels) || !data.levels.length) return "";
    const currentLevel = Number(data.level);
    const selected = levelByNumber(data, currentLevel);
    const progress = safePercent(data.progress_percent);
    const levels = data.levels.map((level) => {
      const earned = level.earned === true;
      const isSelected = Number(level.level) === Number(selected.level);
      const icon = level.icon || (Number(level.level) === 10 ? "◆" : "★");
      return `<button type="button" class="stars-level-button ${earned ? "is-earned" : "is-locked"}${isSelected ? " is-selected" : ""}" data-level="${esc(level.level)}" aria-pressed="${isSelected ? "true" : "false"}" aria-label="معاينة المستوى ${esc(level.level)}: ${esc(level.name)}، ${earned ? "مكتسب" : "مقفل"}"><span class="stars-level-icon" style="--star-color:${safeColor(level.color)}" aria-hidden="true">${esc(icon)}</span><span class="stars-level-copy"><strong>المستوى ${esc(level.level)}</strong><em>${earned ? "مكتسب" : "مقفل"}</em></span></button>`;
    }).join("");
    return `<section class="stars-card" aria-labelledby="stars-title"><div class="stars-heading"><div><h3 id="stars-title">مستويات النجوم</h3><p class="stars-actual-level">المستوى الحالي الفعلي: <b>${esc(currentLevel)} · ${esc(data.name || "")}</b></p></div><span class="stars-current-badge" aria-label="المستوى الحالي الفعلي ${esc(currentLevel)}">★ ${esc(currentLevel)}</span></div><div class="stars-progress-label"><span>التقدم نحو المستوى التالي</span><b>${progress}%</b></div><div class="stars-progress" role="progressbar" aria-label="التقدم نحو المستوى التالي" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><p class="stars-followers">${number(data.followers_count)} متابِع · ${number(data.active_days)} يوم نشاط${data.next_level == null ? " · أعلى مستوى" : ""}</p><div class="stars-levels" role="group" aria-label="اختيار مستوى للمعاينة">${levels}</div><div class="stars-detail" aria-live="polite">${detailMarkup(data, selected)}</div><div class="stars-reward">${rewardMarkup(selected)}</div></section>`;
  }

  async function loadStars(username, container, options) {
    const target = container || (root.document && root.document.getElementById("profile-stars"));
    // api.js declares a top-level const, which is not a window property.
    const client = typeof Api !== "undefined" ? Api : root.Api;
    if (!target || !client || !username) return;
    const token = {};
    requestTokens.set(target, token);
    target.innerHTML = '<div class="stars-loading" role="status">جارٍ تحميل مستويات النجوم…</div>';
    try {
      const data = await client.get(`/api/users/${encodeURIComponent(username)}/stars`);
      if (requestTokens.get(target) !== token || (options && options.isCurrent && !options.isCurrent())) return;
      target.innerHTML = renderStarsCard(data) || '<div class="stars-unavailable">مستويات النجوم غير متاحة لهذا الحساب.</div>';
      const card = target.querySelector && target.querySelector(".stars-card");
      bindCard(card, data);
    } catch (error) {
      if (requestTokens.get(target) !== token || (options && options.isCurrent && !options.isCurrent())) return;
      target.innerHTML = '<div class="stars-unavailable" role="alert"><span>تعذر تحميل مستويات النجوم.</span><button type="button" class="btn btn-outline btn-sm stars-retry">إعادة المحاولة</button></div>';
      const retry = target.querySelector && target.querySelector(".stars-retry");
      if (retry) retry.addEventListener("click", () => loadStars(username, target, options));
    }
  }
  root.renderStarsCard = renderStarsCard;
  root.loadStars = loadStars;
  root.bindStarsCard = bindCard;
})(typeof window !== "undefined" ? window : globalThis);
