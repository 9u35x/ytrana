// عنوان API: محليًا إلى خادم التطوير، وعلى PythonAnywhere إلى نفس النطاق،
// وباقي النسخ المنشورة تستخدم عنوان الـAPI الحالي ما لم يحقن إعداد النشر بديلًا.
const YTRANA_CONFIG = (() => {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const isLocal = localHosts.has(host);
  const isPythonAnywhere = host.endsWith(".pythonanywhere.com");
  return {
    API_BASE: isLocal
      ? "http://127.0.0.1:8000"
      : isPythonAnywhere
        ? window.location.origin
        : "https://270zw.pythonanywhere.com",
  };
})();
