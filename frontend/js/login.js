// منطق صفحة تسجيل الدخول
document.addEventListener("DOMContentLoaded", () => {
  if (Auth.isLoggedIn()) {
    window.location.href = "index.html";
    return;
  }

  const form = document.getElementById("login-form");
  const errorBox = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.classList.remove("show");
    errorBox.textContent = "";

    const username_or_email = document.getElementById("login-identifier").value.trim();
    const password = document.getElementById("login-password").value;

    if (!username_or_email || !password) {
      errorBox.textContent = "يرجى تعبئة جميع الحقول";
      errorBox.classList.add("show");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "جاري تسجيل الدخول...";

    try {
      const data = await Api.post("/api/auth/login", { username_or_email, password });
      Api.setToken(data.access_token);
      Auth.setCurrentUser(data.user);
      window.location.href = "index.html";
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add("show");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "تسجيل الدخول";
    }
  });
});
