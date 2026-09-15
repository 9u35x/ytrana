// منطق صفحة الملف الشخصي
let profileUsername = null;
let profileTab = "posts";

document.addEventListener("DOMContentLoaded", () => {
  Layout.init("profile");

  const params = new URLSearchParams(window.location.search);
  profileUsername = params.get("u");

  if (!profileUsername) {
    const me = Auth.getCurrentUser();
    profileUsername = me ? me.username : null;
  }

  if (!profileUsername) {
    window.location.href = "index.html";
    return;
  }

  document.getElementById("tab-posts").addEventListener("click", () => switchTab("posts"));
  document.getElementById("tab-followers").addEventListener("click", () => switchTab("followers"));
  document.getElementById("tab-following").addEventListener("click", () => switchTab("following"));

  loadProfile();
});

function switchTab(tab) {
  profileTab = tab;

  document.getElementById("tab-posts").classList.toggle("active", tab === "posts");
  document.getElementById("tab-followers").classList.toggle("active", tab === "followers");
  document.getElementById("tab-following").classList.toggle("active", tab === "following");

  loadTabContent();
}

async function loadProfile() {
  const box = document.getElementById("profile-header");

  box.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const profile = await Api.get(
      `/api/users/${encodeURIComponent(profileUsername)}`
    );

    const me = Auth.getCurrentUser();
    const isMe = me && me.id === profile.id;

    box.innerHTML = `
      <div style="display:flex; justify-content:center;">
        ${renderAvatar(profile, "avatar-lg")}
      </div>

      <h2 style="margin-top:12px; font-size:19px;">
        ${escapeHtml(profile.full_name)}
      </h2>

      <div class="post-meta">
        @${escapeHtml(profile.username)}
      </div>

      ${
        profile.bio
          ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>`
          : ""
      }

      <div class="profile-stats">
        <div class="profile-stat">
          <b>${profile.posts_count}</b>
          <span>منشور</span>
        </div>

        <div class="profile-stat">
          <b>${profile.followers_count}</b>
          <span>متابِع</span>
        </div>

        <div class="profile-stat">
          <b>${profile.following_count}</b>
          <span>يتابع</span>
        </div>
      </div>

      <div class="profile-actions">
        ${
          isMe
            ? `
              <a href="settings.html" class="btn btn-outline btn-sm">
                تعديل الملف الشخصي
              </a>
            `
            : `
              <button
                id="follow-btn"
                class="btn ${
                  profile.is_followed_by_me
                    ? "btn-outline"
                    : "btn-primary"
                } btn-sm"
              >
                ${
                  profile.is_followed_by_me
                    ? "إلغاء المتابعة"
                    : "متابعة"
                }
              </button>

              <button
                id="messages-btn"
                class="btn btn-outline btn-sm"
              >
                رسالة
              </button>

              <button
                id="report-user-btn"
                class="btn btn-ghost btn-sm"
              >
                إبلاغ
              </button>
            `
        }
      </div>
    `;

    if (!isMe) {

      // زر المتابعة
      document
        .getElementById("follow-btn")
        .addEventListener("click", async (e) => {

          const btn = e.currentTarget;

          const following =
            btn.textContent.trim() === "إلغاء المتابعة";

          btn.disabled = true;

          try {

            if (following) {
              await Api.del(
                `/api/users/${encodeURIComponent(profileUsername)}/follow`
              );
            } else {
              await Api.post(
                `/api/users/${encodeURIComponent(profileUsername)}/follow`
              );
            }

            loadProfile();

          } catch (err) {

            showToast(err.message, "error");

          } finally {

            btn.disabled = false;

          }
        });


      // زر الرسائل
      document
        .getElementById("messages-btn")
        .addEventListener("click", () => {

          window.location.href =
            `messages.html?u=${encodeURIComponent(profile.username)}`;

        });


      // زر الإبلاغ
      document
        .getElementById("report-user-btn")
        .addEventListener("click", () => {

          openReportModal("user", profile.id);

        });
    }

    loadTabContent();

  } catch (err) {

    box.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

async function loadTabContent() {

  const container =
    document.getElementById("profile-tab-content");

  container.innerHTML =
    '<div class="loading-spinner"></div>';

  try {

    if (profileTab === "posts") {

      const posts = await Api.get(
        `/api/posts/user/${encodeURIComponent(profileUsername)}`
      );

      container.innerHTML = posts.length
        ? posts.map(renderPostCard).join("")
        : `
          <div class="empty-state">
            <p>لا توجد منشورات بعد</p>
          </div>
        `;

      posts.forEach(bindPostCardEvents);

    } else if (profileTab === "followers") {

      const users = await Api.get(
        `/api/users/${encodeURIComponent(profileUsername)}/followers`
      );

      container.innerHTML = users.length
        ? users.map(renderUserListItem).join("")
        : `
          <div class="empty-state">
            <p>لا يوجد متابِعون بعد</p>
          </div>
        `;

    } else {

      const users = await Api.get(
        `/api/users/${encodeURIComponent(profileUsername)}/following`
      );

      container.innerHTML = users.length
        ? users.map(renderUserListItem).join("")
        : `
          <div class="empty-state">
            <p>لا يتابع أحدًا بعد</p>
          </div>
        `;
    }

  } catch (err) {

    container.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function renderUserListItem(u) {

  return `
    <a
      class="user-list-item"
      href="profile.html?u=${encodeURIComponent(u.username)}"
    >
      ${renderAvatar(u, "avatar-md")}

      <div class="user-list-item-info">

        <div class="user-list-item-name">
          ${escapeHtml(u.full_name)}
        </div>

        <div class="user-list-item-username">
          @${escapeHtml(u.username)}
        </div>

      </div>
    </a>
  `;
}
