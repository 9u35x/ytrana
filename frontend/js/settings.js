// منطق صفحة الإعدادات
document.addEventListener("DOMContentLoaded", () => {
  Layout.init("settings");
  loadCurrentData();

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
    } catch (err) {
      showToast(err.message, "error");
    }
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
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const current_password = document.getElementById("current-password").value;
    const new_password = document.getElementById("new-password").value;
    const new_password2 = document.getElementById("new-password2").value;
    if (new_password !== new_password2) {
      showToast("كلمتا المرور الجديدتان غير متطابقتين", "error");
      return;
    }
    try {
      await Api.put("/api/users/me/password", { current_password, new_password });
      showToast("تم تغيير كلمة المرور بنجاح", "success");
      e.target.reset();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("logout-btn").addEventListener("click", () => {
    Auth.logout();
  });

  document.getElementById("delete-account-btn").addEventListener("click", () => {
    document.getElementById("delete-modal").classList.add("show");
  });
  document.getElementById("delete-cancel").addEventListener("click", () => {
    document.getElementById("delete-modal").classList.remove("show");
  });
  document.getElementById("delete-confirm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("delete-password").value;
    try {
      await Api.del("/api/users/me", { password });
      Api.clearToken();
      window.location.href = "login.html";
    } catch (err) {
      showToast(err.message, "error");
    }
  });
});

function loadCurrentData() {
  const user = Auth.getCurrentUser();
  if (!user) return;
  document.getElementById("settings-avatar").innerHTML = renderAvatar(user, "avatar-lg");
  document.getElementById("settings-fullname").value = user.full_name || "";
  Api.get(`/api/users/${encodeURIComponent(user.username)}`).then((profile) => {
    document.getElementById("settings-bio").value = profile.bio || "";
  });
}
