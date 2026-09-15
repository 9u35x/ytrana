// Ytrana Messages
// محادثات + بحث مستخدمين + إرسال واستقبال الرسائل

let currentChatUsername = null;
let pollingInterval = null;
let lastRenderedCount = 0;

const POLL_MS = 3000;

document.addEventListener("DOMContentLoaded", () => {
  Layout.init("messages");

  setupMessagesHeader();
  loadConversationsList();

  const params = new URLSearchParams(window.location.search);
  const openUser = params.get("u");

  const form = document.getElementById("chat-form");

  if (form) {
    form.addEventListener("submit", sendMessage);
  }

  const backButton = document.getElementById("back-to-list");

  if (backButton) {
    backButton.addEventListener("click", () => {
      stopPolling();

      currentChatUsername = null;

      const panel = document.getElementById("chat-panel");

      if (panel) {
        panel.classList.remove("show");
        panel.style.display = "none";
      }

      loadConversationsList();
    });
  }

  if (openUser) {
    openChat(openUser);
  }
});


/* =========================
   البحث
========================= */

function setupMessagesHeader() {
  const container = document.getElementById("conversations-list");

  if (!container) return;

  const oldHeader = document.getElementById("messages-search-header");

  if (oldHeader) {
    oldHeader.remove();
  }

  const header = document.createElement("div");

  header.id = "messages-search-header";

  header.innerHTML = `
    <div style="
      display:flex;
      align-items:center;
      gap:8px;
      padding:12px 0;
      background:var(--y-bg);
      position:sticky;
      top:0;
      z-index:20;
    ">

      <button
        id="new-message-btn"
        class="btn btn-primary btn-sm"
        type="button"
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
        background:var(--y-card,#f5f5f5);
      ">

        <span style="font-size:18px;">🔍</span>

        <input
          id="user-search-input"
          type="search"
          placeholder="ابحث عن مستخدم..."
          autocomplete="off"
          style="
            width:100%;
            flex:1;
            border:none;
            outline:none;
            background:transparent;
            padding:10px 4px;
            color:inherit;
            font-size:14px;
          "
        >

      </div>

    </div>

    <div
      id="user-search-results"
      style="
        display:none;
        background:var(--y-bg);
        border-radius:12px;
        overflow:hidden;
      "
    ></div>
  `;

  container.parentNode.insertBefore(header, container);

  const input = document.getElementById("user-search-input");

  if (!input) return;

  let timer = null;

  input.addEventListener("input", () => {
    const q = input.value.trim();

    clearTimeout(timer);

    if (!q) {
      hideSearchResults();
      return;
    }

    timer = setTimeout(() => {
      searchUsers(q);
    }, 350);
  });

  const newMessageButton =
    document.getElementById("new-message-btn");

  if (newMessageButton) {
    newMessageButton.addEventListener("click", () => {
      input.focus();
    });
  }
}


/* =========================
   البحث عن المستخدم
========================= */

async function searchUsers(q) {
  const results =
    document.getElementById("user-search-results");

  if (!results) return;

  results.style.display = "block";

  results.innerHTML = `
    <div style="
      padding:20px;
      text-align:center;
    ">
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
      .map((user) => `
        <div
          class="search-user-item"
          data-username="${escapeHtml(user.username)}"
          style="
            display:flex;
            align-items:center;
            gap:12px;
            padding:12px;
            border-bottom:1px solid var(--y-border);
            cursor:pointer;
          "
        >

          ${renderAvatar(user, "avatar-md")}

          <div style="
            flex:1;
            min-width:0;
          ">

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
            type="button"
            class="btn btn-primary btn-sm"
          >
            رسالة
          </button>

        </div>
      `)
      .join("");

    results
      .querySelectorAll(".search-user-item")
      .forEach((item) => {

        item.addEventListener("click", () => {
          const username =
            item.getAttribute("data-username");

          if (!username) return;

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
  const results =
    document.getElementById("user-search-results");

  if (!results) return;

  results.style.display = "none";
  results.innerHTML = "";
}


/* =========================
   قائمة المحادثات
========================= */

async function loadConversationsList() {
  const list =
    document.getElementById("conversations-list");

  if (!list) return;

  list.innerHTML =
    '<div class="loading-spinner"></div>';

  try {
    const convs =
      await Api.get("/api/messages");

    if (!convs || convs.length === 0) {

      list.innerHTML = `
        <div class="empty-state">
          <div class="icon">💬</div>
          <p>
            لا توجد محادثات بعد.
            استخدم البحث أعلاه لبدء محادثة.
          </p>
        </div>
      `;

      return;
    }

    list.innerHTML = convs
      .map((c) => `
        <div
          class="conv-item"
          data-username="${escapeHtml(
            c.other_user.username
          )}"
        >

          ${renderAvatar(c.other_user, "avatar-md")}

          <div class="conv-item-info">

            <div class="conv-item-name">
              ${escapeHtml(
                c.other_user.full_name
              )}
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
              ? `
                <span class="conv-unread-badge">
                  ${c.unread_count}
                </span>
              `
              : ""
          }

        </div>
      `)
      .join("");

    list
      .querySelectorAll(".conv-item")
      .forEach((item) => {

        item.addEventListener("click", () => {
          const username =
            item.getAttribute("data-username");

          if (username) {
            openChat(username);
          }
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

  if (!username) return;

  currentChatUsername = username;
  lastRenderedCount = 0;

  stopPolling();

  const panel =
    document.getElementById("chat-panel");

  const name =
    document.getElementById("chat-with-name");

  const avatar =
    document.getElementById("chat-with-avatar");

  const input =
    document.getElementById("chat-input");


  /* إظهار المحادثة بالقوة */
  if (panel) {
    panel.classList.add("show");

    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.position = "fixed";
    panel.style.inset = "0";
    panel.style.zIndex = "99999";
  }


  if (name) {
    name.textContent = username;
  }

  if (avatar) {
    avatar.innerHTML = "";
  }


  /* تحميل بيانات المستخدم */
  try {

    const profile =
      await Api.get(
        `/api/users/${encodeURIComponent(username)}`
      );

    if (name) {
      name.textContent =
        profile.full_name || username;
    }

    if (avatar) {
      avatar.innerHTML =
        renderAvatar(profile, "avatar-sm");
    }

  } catch (err) {
    console.log(
      "تعذر تحميل الملف الشخصي:",
      err
    );
  }


  /* تحميل الرسائل */
  await loadChatMessages(username, true);


  /* إظهار خانة الكتابة */
  if (input) {
    input.disabled = false;

    setTimeout(() => {
      input.focus();
    }, 100);
  }


  /* تحديث كل 3 ثواني */
  pollingInterval =
    setInterval(() => {

      if (
        currentChatUsername === username
      ) {
        loadChatMessages(
          username,
          false
        );
      }

    }, POLL_MS);
}


/* =========================
   إرسال رسالة
========================= */

async function sendMessage(e) {

  e.preventDefault();

  const input =
    document.getElementById("chat-input");

  if (!input) return;

  const content =
    input.value.trim();

  if (!content) return;

  if (!currentChatUsername) {
    showToast(
      "اختر مستخدمًا أولاً",
      "error"
    );
    return;
  }

  const username =
    currentChatUsername;

  input.disabled = true;

  try {

    await Api.post(
      `/api/messages/${encodeURIComponent(username)}`,
      {
        content: content
      }
    );

    input.value = "";

    await loadChatMessages(
      username,
      true
    );

  } catch (err) {

    showToast(
      err.message || "فشل إرسال الرسالة",
      "error"
    );

  } finally {

    input.disabled = false;
    input.focus();
  }
}


/* =========================
   إيقاف التحديث
========================= */

function stopPolling() {

  if (pollingInterval) {

    clearInterval(
      pollingInterval
    );

    pollingInterval = null;
  }
}


/* =========================
   تحميل الرسائل
========================= */

async function loadChatMessages(
  username,
  forceScroll
) {

  const box =
    document.getElementById(
      "chat-messages"
    );

  if (!box) return;

  try {

    const messages =
      await Api.get(
        `/api/messages/${encodeURIComponent(username)}`
      );

    if (
      messages.length ===
        lastRenderedCount &&
      !forceScroll
    ) {
      return;
    }

    lastRenderedCount =
      messages.length;

    const me =
      Auth.getCurrentUser();

    if (!messages.length) {

      box.innerHTML = `
        <div class="empty-state">
          <p>
            ابدأ المحادثة بكتابة أول رسالة 👋
          </p>
        </div>
      `;

    } else {

      box.innerHTML =
        messages
          .map((m) => {

            const mine =
              me &&
              m.sender &&
              me.id === m.sender.id;

            return `
              <div
                class="chat-bubble-row ${
                  mine ? "mine" : ""
                }"
              >

                <div class="chat-bubble">
                  ${escapeHtml(
                    m.content
                  )}
                </div>

              </div>
            `;
          })
          .join("");
    }


    if (forceScroll) {
      setTimeout(() => {
        box.scrollTop =
          box.scrollHeight;
      }, 50);
    }


    if (
      typeof Layout !== "undefined" &&
      Layout.refreshNotifBadge
    ) {
      Layout.refreshNotifBadge();
    }

  } catch (err) {

    if (forceScroll) {

      box.innerHTML = `
        <div class="empty-state">
          <p>
            ${escapeHtml(
              err.message ||
              "تعذر تحميل الرسائل"
            )}
          </p>
        </div>
      `;
    }
  }
}
