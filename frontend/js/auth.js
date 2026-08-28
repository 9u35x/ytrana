// أدوات مساعدة للمصادقة، تُستخدم في جميع الصفحات
const Auth = (() => {
  function getCurrentUser() {
    const raw = localStorage.getItem("ytrana_user");
    return raw ? JSON.parse(raw) : null;
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
