// منطق صفحة الدردشة — قائمة محادثات + محادثة مفتوحة مع تحديث شبه فوري
let currentChatUsername = null;
let pollingInterval = null;
const POLL_MS = 3000;

document.addEventListener("DOMContentLoaded", () => {
  Layout.init("messages");

  const params = new URLSearchParams(window.location.search);
  const openUser = params.get("u");

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
      await Api.post(`/api/messages/${currentChatUsername}`, { content });
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

async function loadConversationsList() {
  const list = document.getElementById("conversations-list");
  list.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const convs = await Api.get("/api/messages");
    if (convs.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="icon">💬</div><p>لا توجد محادثات بعد. ابدأ محادثة من ملف أي مستخدم.</p></div>`;
      return;
    }
    list.innerHTML = convs
      .map(
        (c) => `<div class="conv-item" data-username="${c.other_user.username}">
        ${renderAvatar(c.other_user, "avatar-md")}
        <div class="conv-item-info">
          <div class="conv-item-name">${escapeHtml(c.other_user.full_name)}</div>
          <div class="conv-item-last">${c.last_message ? escapeHtml(c.last_message) : "بدون رسائل بعد"}</div>
        </div>
        ${c.unread_count > 0  ? `<span class="conv-unread-badge">${c.unread_count}</span>` : ""}
      </div>`
      )
      .join("");

    list.querySelectorAll(".conv-item").forEach((el) => {
      el.addEventListener("click", () => openChat(el.dataset.username));
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function openChat(username) {
  currentChatUsername = username;
  document.getElementById("chat-panel").classList.add("show");
  document.getElementById("chat-with-name").textContent = username;

  try {
    const profile = await Api.get(`/api/users/${encodeURIComponent(username)}`);
    document.getElementById("chat-with-name").textContent = profile.full_name;
    document.getElementById("chat-with-avatar").innerHTML = renderAvatar(profile, "avatar-sm");
  } catch (e) {
    // تجاهل، الاسم الافتراضي يكفي
  }

  await loadChatMessages(username, true);
  stopPolling();
  pollingInterval = setInterval(() => loadChatMessages(username, false), POLL_MS);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

let lastRenderedCount = 0;

async function loadChatMessages(username, forceScroll) {
  const box = document.getElementById("chat-messages");
  try {
    const messages = await Api.get(`/api/messages/${encodeURIComponent(username)}`);
    if (messages.length === lastRenderedCount && !forceScroll) return;
    lastRenderedCount = messages.length;

    const me = Auth.getCurrentUser();
    box.innerHTML = messages.length
      ? messages
          .map((m) => {
            const mine = me && me.id === m.sender.id;
            return `<div class="chat-bubble-row ${mine ? "mine" : ""}">
              <div class="chat-bubble">${escapeHtml(m.content)}</div>
            </div>`;
          })
          .join("")
      : `<div class="empty-state"><p>ابدأ المحادثة بكتابة أول رسالة 👋</p></div>`;

    box.scrollTop = box.scrollHeight;
    Layout.refreshNotifBadge();
  } catch (err) {
    if (forceScroll) {
      box.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }
      }
