// طبقة الاتصال بالـ API - جميع طلبات الشبكة تمر من هنا
const Api = (() => {
  function getToken() {
    return localStorage.getItem("ytrana_token");
  }

  function setToken(token) {
    localStorage.setItem("ytrana_token", token);
  }

  function clearToken() {
    localStorage.removeItem("ytrana_token");
    localStorage.removeItem("ytrana_user");
  }

  async function request(path, { method = "GET", body = null, isForm = false } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let payload = body;
    if (body && !isForm) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`${YTRANA_CONFIG.API_BASE}${path}`, {
        method,
        headers,
        body: payload,
      });
    } catch (err) {
      throw new Error("تعذر الاتصال بالخادم. تأكد من تشغيل الخادم الخلفي.");
    }

    let data = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    }

    if (!response.ok) {
      const message = (data && data.detail) || "حدث خطأ غير متوقع";
      if (response.status === 401) {
        clearToken();
      }
      throw new Error(typeof message === "string" ? message : "حدث خطأ غير متوقع");
    }

    return data;
  }

  return {
    getToken,
    setToken,
    clearToken,
    get: (path) => request(path),
    post: (path, body, isForm = false) => request(path, { method: "POST", body, isForm }),
    put: (path, body, isForm = false) => request(path, { method: "PUT", body, isForm }),
    del: (path, body = null) => request(path, { method: "DELETE", body }),
  };
})();
