// أدوات مساعدة للمصادقة، تُستخدم في جميع الصفحات
const Auth = (() => {
  function getCurrentUser() {
    try {
      const raw = localStorage.getItem("ytrana_user");
      if (!raw) return null;
      const user = JSON.parse(raw);
      if (user && !Array.isArray(user) && typeof user === "object" &&
          Number.isInteger(user.id) && user.id > 0 &&
          typeof user.username === "string" && user.username.length > 0) {
        return user;
      }
    } catch (error) {
      // A corrupt cache or restricted storage must not crash every page.
    }
    try { localStorage.removeItem("ytrana_user"); } catch (error) { /* unavailable storage */ }
    return null;
  }

  function setCurrentUser(user) {
    localStorage.setItem("ytrana_user", JSON.stringify(user));
  }

  function isLoggedIn() {
    return !!Api.getToken();
  }

  function requireAuth() {
    if (!isLoggedIn()) {
      window.location.href = "login.html";
    }
  }

  async function logout() {
    try {
      await Api.post("/api/auth/logout");
    } catch (e) {
      // نتجاهل الخطأ؛ سنمسح التوكن محليًا على أي حال
    }
    Api.clearToken();
    window.location.href = "login.html";
  }

  return { getCurrentUser, setCurrentUser, isLoggedIn, requireAuth, logout };
})();
