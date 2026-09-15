// منطق صفحة الدردشة — محادثات + بحث حقيقي عن المستخدمين + محادثة مفتوحة
let currentChatUsername = null;
let pollingInterval = null;
const POLL_MS = 3000;

document.addEventListener("DOMContentLoaded", () => {
  Layout.init("messages");

  const params = new URLSearchParams(window.location.search);
  const openUser = params.get("u");

  // إضافة واجهة البحث
  setupMessagesHeader();

  loadConversationsList();

  if (openUser) {
    openChat(openUser);
  }

  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const input = document.getElementById("chat-input");
    const content = input.value.trim();

    if (!content || !currentChatUsername) return;

    input.value = "";

    try {
      await Api.post(`/api/messages/${encodeURIComponent(currentChatUsername)}`, {
        content
      });

      await loadChatMessages(currentChatUsername, true);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("back-to-list").addEventListener("click", () => {
    stopPolling();

    currentChatUsername = null;

    document.getElementById("chat-panel").classList.remove("show");

    loadConversationsList();
  });
});


/* =========================
   واجهة البحث
========================= */

function setupMessagesHeader() {
  const container = document.getElementById("conversations-list");

  const header = document.createElement("div");

  header.id = "messages-search-header";

  header.innerHTML = `
    <div style="
      display:flex;
      align-items:center;
      gap:8px;
      padding:12px 0;
      position:sticky;
      top:0;
      background:var(--y-bg);
      z-index:5;
    ">

      <button
        id="new-message-btn"
        class="btn btn-primary btn-sm"
        style="white-space:nowrap;"
      >
        رسالة جديدة
      </button>

      <div style="
        flex:1;
        display:flex;
        align-items:center;
        gap:6px;
        border:1px solid var(--y-border);
        border-radius:12px;
        padding:0 10px;
        background:var(--y-card);
      ">

        <span style="font-size:18px;">🔍</span>

        <input
          id="user-search-input"
          type="search"
          placeholder="ابحث عن مستخدم..."
          autocomplete="off"
          style="
            flex:1;
            border:none;
            outline:none;
            background:transparent;
            padding:10px 4px;
            color:inherit;
          "
        >

      </div>

    </div>

    <div
      id="user-search-results"
      style="display:none;"
    ></div>
  `;

  container.parentNode.insertBefore(header, container);

  const input = document.getElementById("user-search-input");

  let searchTimer = null;

  input.addEventListener("input", () => {
    const q = input.value.trim();

    clearTimeout(searchTimer);

    if (!q) {
      hideSearchResults();
      return;
    }

    searchTimer = setTimeout(() => {
      searchUsers(q);
    }, 350);
  });

  document
    .getElementById("new-message-btn")
    .addEventListener("click", () => {
      input.focus();
      input.select();
    });
}


/* =========================
   البحث الحقيقي عن المستخدمين
========================= */

async function searchUsers(q) {
  const results = document.getElementById("user-search-results");

  results.style.display = "block";

  results.innerHTML = `
    <div style="padding:20px;text-align:center;">
      <div class="loading-spinner"></div>
    </div>
  `;

  try {
    const users = await Api.get(
      `/api/users/search?q=${encodeURIComponent(q)}`
    );

    if (!users || users.length === 0) {
      results.innerHTML = `
        <div class="empty-state">
          <div class="icon">🔍</div>
          <p>لم يتم العثور على مستخدمين</p>
        </div>
      `;

      return;
    }

    results.innerHTML = users
      .map(
        (user) => `
          <div
            class="search-user-item"
            data-username="${escapeHtml(user.username)}"
            style="
              display:flex;
              align-items:center;
              gap:12px;
              padding:12px 8px;
              border-bottom:1px solid var(--y-border);
              cursor:pointer;
            "
          >

            ${renderAvatar(user, "avatar-md")}

            <div style="flex:1;min-width:0;">

              <div style="
                font-weight:600;
                font-size:14px;
              ">
                ${escapeHtml(user.full_name)}
              </div>

              <div style="
                color:var(--y-text-secondary);
                font-size:13px;
                margin-top:3px;
              ">
                @${escapeHtml(user.username)}
              </div>

            </div>

            <button
              class="btn btn-outline btn-sm start-chat-btn"
              type="button"
            >
              رسالة
            </button>

          </div>
        `
      )
      .join("");

    results.querySelectorAll(".search-user-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        const username = item.dataset.username;

        openChat(username);
        hideSearchResults();
      });
    });

  } catch (err) {
    results.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}


function hideSearchResults() {
  const results = document.getElementById("user-search-results");

  if (!results) return;

  results.style.display = "none";
  results.innerHTML = "";
}


/* =========================
   قائمة المحادثات
========================= */

async function loadConversationsList() {
  const list = document.getElementById("conversations-list");

  list.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const convs = await Api.get("/api/messages");

    if (convs.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="icon">💬</div>
          <p>
            لا توجد محادثات بعد.
            استخدم البحث أعلاه للعثور على شخص وابدأ محادثة.
          </p>
        </div>
      `;

      return;
    }

    list.innerHTML = convs
      .map(
        (c) => `
          <div
            class="conv-item"
            data-username="${escapeHtml(c.other_user.username)}"
          >

            ${renderAvatar(c.other_user, "avatar-md")}

            <div class="conv-item-info">

              <div class="conv-item-name">
                ${escapeHtml(c.other_user.full_name)}
              </div>

              <div class="conv-item-last">
                ${
                  c.last_message
                    ? escapeHtml(c.last_message)
                    : "بدون رسائل بعد"
                }
              </div>

            </div>

            ${
              c.unread_count > 0
                ? `<span class="conv-unread-badge">${c.unread_count}</span>`
                : ""
            }

          </div>
        `
      )
      .join("");

    list.querySelectorAll(".conv-item").forEach((el) => {
      el.addEventListener("click", () => {
        openChat(el.dataset.username);
      });
    });

  } catch (err) {
    list.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}


/* =========================
   فتح المحادثة
========================= */

async function openChat(username) {
  currentChatUsername = username;

  document.getElementById("chat-panel").classList.add("show");

  document.getElementById("chat-with-name").textContent = username;

  document.getElementById("chat-with-avatar").innerHTML = "";

  try {
    const profile = await Api.get(
      `/api/users/${encodeURIComponent(username)}`
    );

    document.getElementById("chat-with-name").textContent =
      profile.full_name;

    document.getElementById("chat-with-avatar").innerHTML =
      renderAvatar(profile, "avatar-sm");

  } catch (e) {
    // الاسم الافتراضي يكفي
  }

  lastRenderedCount = 0;

  await loadChatMessages(username, true);

  stopPolling();

  pollingInterval = setInterval(() => {
    if (currentChatUsername === username) {
      loadChatMessages(username, false);
    }
  }, POLL_MS);
}


/* =========================
   إيقاف التحديث
========================= */

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}


/* =========================
   تحميل الرسائل
========================= */

let lastRenderedCount = 0;

async function loadChatMessages(username, forceScroll) {
  const box = document.getElementById("chat-messages");

  try {
    const messages = await Api.get(
      `/api/messages/${encodeURIComponent(username)}`
    );

    if (
      messages.length === lastRenderedCount &&
      !forceScroll
    ) {
      return;
    }

    lastRenderedCount = messages.length;

    const me = Auth.getCurrentUser();

    box.innerHTML = messages.length
      ? messages
          .map((m) => {
            const mine =
              me && me.id === m.sender.id;

            return `
              <div class="chat-bubble-row ${mine ? "mine" : ""}">
                <div class="chat-bubble">
                  ${escapeHtml(m.content)}
                </div>
              </div>
            `;
          })
          .join("")
      : `
          <div class="empty-state">
            <p>ابدأ المحادثة بكتابة أول رسالة 👋</p>
          </div>
        `;

    box.scrollTop = box.scrollHeight;

    Layout.refreshNotifBadge();

  } catch (err) {

    if (forceScroll) {
      box.innerHTML = `
        <div class="empty-state">
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    }

  }
}
