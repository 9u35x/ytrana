// إدارة الوضع الليلي (Dark Mode)
const Theme = (() => {
  function init() {
    const saved = localStorage.getItem("ytrana_theme") || "light";
    apply(saved);
  }
  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ytrana_theme", theme);
    document.querySelectorAll(".theme-toggle-input").forEach((el) => {
      el.checked = theme === "dark";
    });
  }
  function toggle() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    apply(current === "dark" ? "light" : "dark");
  }
  return { init, apply, toggle };
})();

Theme.init();
