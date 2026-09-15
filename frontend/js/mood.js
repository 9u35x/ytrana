// منطق شريط المزاج (يشبه القصص) — عرض مزاج المستخدمين المتابَعين + تحديد مزاجي
let allMoods = [];

document.addEventListener("DOMContentLoaded", () => {
  loadMoodBar();

  const addBtn = document.getElementById("mood-add-btn");
  if (addBtn) addBtn.addEventListener("click", openMoodPicker);

  const closeBtn = document.getElementById("mood-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", closeMoodPicker);
});

async function loadMoodBar() {
  const bar = document.getElementById("mood-bar");
  if (!bar) return;
  try {
    const [feed, mine] = await Promise.all([
      Api.get("/api/moods/feed"),
      Api.get("/api/moods/me").catch(() => null),
    ]);

    const me = Auth.getCurrentUser();
    const myMoodHtml = `
      <div class="mood-item" id="mood-add-btn">
        <div class="mood-ring ${mine ? "has-mood" : "empty"}" style="${mine ? `--mood-color:${mine.mood.color}` : ""}">
          ${mine ? `<span class="mood-emoji">${mine.mood.emoji}</span>` : renderAvatar(me, "avatar-md")}
        </div>
        <span class="mood-item-label">${mine ? "مزاجي" : "أضف مزاجك"}</span>
      </div>
    `;

    const othersHtml = feed
      .filter((s) => !me || s.user.id !== me.id)
      .map(
        (s) => `<div class="mood-item">
          <div class="mood-ring has-mood" style="--mood-color:${s.mood.color}">
            <span class="mood-emoji">${s.mood.emoji}</span>
          </div>
          <span class="mood-item-label">${escapeHtml(s.user.full_name.split(" ")[0])}</span>
        </div>`
      )
      .join("");

    bar.innerHTML = myMoodHtml + othersHtml;
    document.getElementById("mood-add-btn").addEventListener("click", openMoodPicker);
  } catch (err) {
    bar.innerHTML = "";
  }
}

async function openMoodPicker() {
  const modal = document.getElementById("mood-modal");
  const grid = document.getElementById("mood-grid");
  modal.classList.add("show");
  grid.innerHTML = '<div class="loading-spinner"></div>';

  try {
    if (allMoods.length === 0) {
      allMoods = await Api.get("/api/moods");
    }
    grid.innerHTML = allMoods
      .map(
        (m) => `<button type="button" class="mood-option" data-key="${m.key}" style="--mood-color:${m.color}">
          <span class="mood-option-emoji">${m.emoji}</span>
          <span>${escapeHtml(m.label_ar)}</span>
        </button>`
      )
      .join("");

    grid.querySelectorAll(".mood-option").forEach((btn) => {
      btn.addEventListener("click", () => submitMood(btn.dataset.key));
    });
  } catch (err) {
    grid.innerHTML = `<p>${escapeHtml(err.message)}</p>`;
  }
}

function closeMoodPicker() {
  document.getElementById("mood-modal").classList.remove("show");
}

async function submitMood(moodKey) {
  try {
    await Api.post("/api/moods", { mood_key: moodKey });
    closeMoodPicker();
    showToast("تم تحديث مزاجك", "success");
    loadMoodBar();
  } catch (err) {
    showToast(err.message, "error");
  }
}
