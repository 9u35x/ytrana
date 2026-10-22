// منطق الصفحة الرئيسية (Feed)
let selectedImageFile = null;
let selectedMediaKind = "image";
let currentFeedMode = "explore"; // feed | explore

document.addEventListener("DOMContentLoaded", () => {
  Layout.init("index");

  const composerText = document.getElementById("composer-text");
  const composerImageInput = document.getElementById("composer-image-input");
  const composerPreview = document.getElementById("composer-preview");
  const composerPreviewImg = document.getElementById("composer-preview-img");
  const composerPreviewVideo = document.getElementById("composer-preview-video");
  const composerSubmit = document.getElementById("composer-submit");
  const feedTabFollowing = document.getElementById("feed-tab-following");
  const feedTabExplore = document.getElementById("feed-tab-explore");

  const me = Auth.getCurrentUser();
  document.getElementById("composer-avatar").innerHTML = renderAvatar(me, "avatar-md");

  composerImageInput.addEventListener("change", () => {
    const file = composerImageInput.files[0];
    if (!file) return;

    selectedImageFile = file;
    selectedMediaKind = file.type.startsWith("video/") ? "video" : "image";

    const reader = new FileReader();

    reader.onload = (e) => {
      composerPreviewImg.src = e.target.result;
      composerPreviewImg.style.display = selectedMediaKind === "image" ? "block" : "none";
      composerPreviewVideo.src = selectedMediaKind === "video" ? e.target.result : "";
      composerPreviewVideo.style.display = selectedMediaKind === "video" ? "block" : "none";
      composerPreview.classList.add("show");
    };

    reader.readAsDataURL(file);
  });

  document.getElementById("composer-remove-img").addEventListener("click", () => {
    selectedImageFile = null;
    composerImageInput.value = "";
    composerPreview.classList.remove("show");
  });

  composerSubmit.addEventListener("click", async () => {
    const text = composerText.value.trim();

    if (!text && !selectedImageFile) {
      showToast("اكتب شيئًا أو أضف صورة أو فيديو أولًا", "error");
      return;
    }

    composerSubmit.disabled = true;

    try {
      const formData = new FormData();

      if (text) {
        formData.append("content", text);
      }

      if (selectedImageFile) {
        formData.append(selectedMediaKind, selectedImageFile);
      }

      formData.append("mood_key", document.querySelector("input[name=\"composer-mood\"]:checked")?.value || "");
      const hasNewMediaFields = selectedMediaKind === "video" || Boolean(formData.get("mood_key"));
      await Api.post(hasNewMediaFields ? "/api/media/posts" : "/api/posts", formData, true);

      composerText.value = "";
      selectedImageFile = null;
      selectedMediaKind = "image";
      composerImageInput.value = "";
      composerPreview.classList.remove("show");
      composerPreviewVideo.style.display = "none";

      showToast("تم نشر المنشور", "success");

      loadFeed();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      composerSubmit.disabled = false;
    }
  });

  feedTabFollowing.addEventListener("click", () => switchTab("feed"));
  feedTabExplore.addEventListener("click", () => switchTab("explore"));

  function switchTab(mode) {
    currentFeedMode = mode;

    feedTabFollowing.classList.toggle("active", mode === "feed");
    feedTabExplore.classList.toggle("active", mode === "explore");

    loadFeed();
  }

  loadFeed();
});

async function loadFeed() {
  const list = document.getElementById("feed-list");

  list.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const path =
      currentFeedMode === "feed"
        ? "/api/posts/feed"
        : "/api/posts/explore";

    const basePosts = await Api.get(path);
    let posts = basePosts;
    if (basePosts.length) {
      const ids = basePosts.map((post) => post.id).join(",");
      const mediaPosts = await Api.get(`/api/media/posts?ids=${encodeURIComponent(ids)}`).catch(() => []);
      const mediaById = new Map((mediaPosts || []).map((post) => [post.id, post]));
      posts = basePosts.map((post) => ({ ...post, ...(mediaById.get(post.id) || {}) }));
    }

    if (posts.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <div class="icon">📭</div>
        <p>${
          currentFeedMode === "feed"
            ? "لا توجد منشورات بعد. تابع بعض الأشخاص لترى منشوراتهم هنا."
            : "لا توجد منشورات بعد."
        }</p>
      </div>`;

      return;
    }

    list.innerHTML = posts.map(renderPostCard).join("");

    posts.forEach(bindPostCardEvents);
  } catch (err) {
    list.innerHTML = `<div class="empty-state">
      <p>${escapeHtml(err.message)}</p>
    </div>`;
  }
}
