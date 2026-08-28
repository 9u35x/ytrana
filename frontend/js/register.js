// منطق صفحة إنشاء حساب جديد
document.addEventListener("DOMContentLoaded", () => {
  if (Auth.isLoggedIn()) {
    window.location.href = "index.html";
    return;
  }

  const form = document.getElementById("register-form");
  const errorBox = document.getElementById("register-error");
  const submitBtn = document.getElementById("register-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.classList.remove("show");
    errorBox.textContent = "";

    const full_name = document.getElementById("reg-fullname").value.trim();
    const username = document.getElementById("reg-username").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const password2 = document.getElementById("reg-password2").value;

    if (!full_name || !username || !email || !password) {
      errorBox.textContent = "يرجى تعبئة جميع الحقول";
      errorBox.classList.add("show");
      return;
    }
    if (password !== password2) {
      errorBox.textContent = "كلمتا المرور غير متطابقتين";
      errorBox.classList.add("show");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "جاري إنشاء الحساب...";

    try {
      const data = await Api.post("/api/auth/register", { full_name, username, email, password });
      Api.setToken(data.access_token);
      Auth.setCurrentUser(data.user);
      window.location.href = "index.html";
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add("show");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "إنشاء حساب";
    }
  });
});
