// منطق صفحة تسجيل الدخول بخطوة OTP اختيارية
const LOGIN_OTP_LABELS = { email: "البريد الإلكتروني", sms: "رسالة SMS", totp: "تطبيق المصادقة" };

document.addEventListener("DOMContentLoaded", () => {
  if (Auth.isLoggedIn()) {
    window.location.href = "index.html";
    return;
  }

  const form = document.getElementById("login-form");
  const errorBox = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  const otpForm = document.getElementById("login-otp-form");
  const otpMethod = document.getElementById("login-otp-method");
  const otpCode = document.getElementById("login-otp-code");
  const otpCodeGroup = document.getElementById("login-otp-code-group");
  const otpError = document.getElementById("login-otp-error");
  const otpHint = document.getElementById("login-otp-hint");
  const otpSubmit = document.getElementById("login-otp-submit");
  let challengeId = null;
  let otpStarted = false;

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
      if (data.requires_otp) {
        challengeId = data.challenge_id;
        const methods = data.available_methods || [];
        otpMethod.innerHTML = methods.map((method) => {
          const hint = method === "email" ? data.email_hint : method === "sms" ? data.phone_hint : "";
          const label = `${LOGIN_OTP_LABELS[method] || method}${hint ? ` · ${hint}` : ""}`;
          return `<option value="${escapeHtml(method)}">${escapeHtml(label)}</option>`;
        }).join("");
        if (!methods.length || !challengeId) throw new Error("لا توجد طريقة تحقق متاحة؛ تواصل مع مسؤول المنصة.");
        otpStarted = false;
        otpCode.value = "";
        otpCodeGroup.hidden = true;
        otpError.classList.remove("show");
        otpError.textContent = "";
        otpHint.textContent = "تم التحقق من كلمة المرور. أكمل الخطوة الثانية لتسجيل الدخول.";
        form.hidden = true;
        otpForm.hidden = false;
        otpMethod.focus();
        return;
      }
      completeLogin(data);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add("show");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "تسجيل الدخول";
    }
  });

  otpMethod.addEventListener("change", () => {
    otpStarted = false;
    otpCode.value = "";
    otpCodeGroup.hidden = true;
    otpSubmit.textContent = "متابعة";
    otpError.classList.remove("show");
    otpError.textContent = "";
  });

  otpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    otpError.classList.remove("show");
    otpError.textContent = "";
    otpSubmit.disabled = true;
    try {
      if (!otpStarted) {
        const response = await Api.post("/api/auth/login/otp/start", {
          challenge_id: challengeId,
          method: otpMethod.value,
        });
        otpStarted = true;
        otpCodeGroup.hidden = false;
        otpHint.textContent = response.message || "أدخل رمز التحقق لإكمال تسجيل الدخول.";
        if (response.target_hint) otpHint.textContent += ` (${response.target_hint})`;
        otpSubmit.textContent = "تحقق وأكمل الدخول";
        otpCode.focus();
        return;
      }
      const code = otpCode.value.trim();
      if (!/^[0-9]{6}$/.test(code)) throw new Error("أدخل رمز التحقق المكوّن من 6 أرقام.");
      const data = await Api.post("/api/auth/login/otp/verify", { challenge_id: challengeId, code });
      completeLogin(data);
    } catch (err) {
      otpError.textContent = err.message;
      otpError.classList.add("show");
    } finally {
      otpSubmit.disabled = false;
    }
  });

  document.getElementById("login-otp-back").addEventListener("click", () => {
    challengeId = null;
    otpStarted = false;
    otpCode.value = "";
    otpForm.hidden = true;
    form.hidden = false;
    document.getElementById("login-password").focus();
  });

  function completeLogin(data) {
    if (!data?.access_token || !data?.user) throw new Error("تعذر إنشاء جلسة الدخول بعد التحقق.");
    Api.setToken(data.access_token);
    Auth.setCurrentUser(data.user);
    window.location.href = "index.html";
  }
});
