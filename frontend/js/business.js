Layout.init("community");
const businessId = Number(new URLSearchParams(location.search).get("id")) || null;
let activeBusiness = null;

function businessImage(url, className, alt = "") {
  const src = url ? postMediaUrl(url) : null;
  return src ? `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">` : "";
}
function businessCard(page) {
  const avatar = businessImage(page.image_url, "entity-avatar", "");
  return `<a class="entity-card card" href="business.html?id=${page.id}">${avatar || `<span class="entity-avatar entity-avatar-placeholder">${escapeHtml((page.name || "ن").slice(0,1))}</span>`}<div class="entity-card-main"><h3>${escapeHtml(page.name)}</h3><p>${escapeHtml(page.description || "لا توجد نبذة بعد")}</p><div class="entity-meta"><span>${page.followers_count} متابع</span><span>${page.products_count} بطاقة</span><span>${page.posts_count} منشور</span></div></div><span class="btn btn-outline btn-sm">الصفحة</span></a>`;
}
async function loadMyBusinessPage() {
  const host = document.getElementById("my-business-page");
  try {
    const page = await Api.get("/api/business/pages/mine");
    if (!page) {
      host.innerHTML = '<p class="feature-subtitle">لا توجد صفحة نشاط مرتبطة بحسابك بعد.</p>';
      document.getElementById("business-create-form").classList.remove("hidden");
      return;
    }
    document.getElementById("business-create-form").classList.add("hidden");
    if (!page.is_active) {
      host.innerHTML = `<div class="feature-inline"><strong>${escapeHtml(page.name)}</strong><span class="feature-status warning">الصفحة متوقفة مؤقتًا</span><button id="business-restore" class="btn btn-primary btn-sm">إعادة التفعيل</button></div>`;
      document.getElementById("business-restore").onclick = async () => { try { await Api.put(`/api/business/pages/${page.id}/restore`); showToast("تمت إعادة تفعيل الصفحة","success"); loadMyBusinessPage(); } catch (err) { showToast(err.message,"error"); } };
    } else host.innerHTML = businessCard(page);
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
async function loadBusinessList(q = "") {
  const host = document.getElementById("business-list");
  host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const pages = await Api.get(`/api/business/pages?q=${encodeURIComponent(q)}&limit=50`);
    host.innerHTML = pages.length ? pages.map(businessCard).join("") : '<p class="feature-empty">لم نعثر على صفحات أعمال مطابقة.</p>';
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
async function loadBusinessDetail() {
  document.getElementById("business-list-view").classList.add("hidden");
  document.getElementById("business-detail-view").classList.remove("hidden");
  const detail = document.getElementById("business-detail");
  detail.innerHTML = '<div class="loading-spinner"></div>';
  try {
    activeBusiness = await Api.get(`/api/business/pages/${businessId}`);
    const page = activeBusiness;
    const cover = businessImage(page.cover_url || page.image_url, "feature-banner", page.name);
    detail.innerHTML = `<section class="card feature-panel">${cover}<div class="feature-inline"><h1>${escapeHtml(page.name)}</h1>${page.is_followed_by_me ? '<span class="pill">تتابعها</span>' : ""}</div><p class="feature-subtitle">${escapeHtml(page.description || "لا توجد نبذة بعد")}</p><div class="metric-strip"><div class="metric-box"><strong>${page.followers_count}</strong><span>متابع</span></div><div class="metric-box"><strong>${page.views_count}</strong><span>زيارة فريدة</span></div><div class="metric-box"><strong>${page.posts_count}</strong><span>منشور</span></div><div class="metric-box"><strong>${page.likes_count + page.comments_count}</strong><span>تفاعل</span></div></div><small class="feature-subtitle">تُحتسب الزيارة مرة واحدة لكل حساب مسجّل.</small><div class="entity-meta"><span>صاحب النشاط: ${escapeHtml(page.owner.full_name)} (@${escapeHtml(page.owner.username)})</span>${page.contact_phone ? `<span>هاتف: ${escapeHtml(page.contact_phone)}</span>` : ""}${page.contact_email ? `<span>بريد: ${escapeHtml(page.contact_email)}</span>` : ""}${page.website_url ? `<span>موقع: ${escapeHtml(page.website_url)}</span>` : ""}</div><div id="business-follow-action" class="feature-form-actions" style="margin-top:12px">${page.is_owner ? '<span class="feature-status success">هذه صفحة نشاطك</span>' : `<button id="business-follow" class="btn ${page.is_followed_by_me ? "btn-outline" : "btn-primary"}">${page.is_followed_by_me ? "إلغاء المتابعة" : "متابعة النشاط"}</button>`}</div></section>`;
    const edit = document.getElementById("business-edit-section");
    const productForm = document.getElementById("business-product-form");
    const postForm = document.getElementById("business-post-form");
    edit.classList.toggle("hidden", !page.is_owner);
    productForm.classList.toggle("hidden", !page.is_owner);
    postForm.classList.toggle("hidden", !page.is_owner);
    if (page.is_owner) {
      const form = document.getElementById("business-edit-form");
      for (const key of ["name","description","contact_email","contact_phone","website_url"]) form.elements[key].value = page[key] || "";
      document.getElementById("business-archive").onclick = async () => { if (!confirm("سيتم إيقاف الصفحة مؤقتًا مع الاحتفاظ بالبيانات. متابعة؟")) return; try { await Api.put(`/api/business/pages/${businessId}/archive`); showToast("تم إيقاف الصفحة","success"); location.href = "business.html"; } catch (err) { showToast(err.message,"error"); } };
    }
    const follow = document.getElementById("business-follow");
    if (follow) follow.onclick = async () => { try { if (page.is_followed_by_me) await Api.del(`/api/business/pages/${businessId}/follow`); else await Api.post(`/api/business/pages/${businessId}/follow`); await loadBusinessDetail(); } catch (err) { showToast(err.message,"error"); } };
    await Promise.all([loadBusinessProducts(), loadBusinessPosts()]);
  } catch (err) { detail.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
async function loadBusinessProducts() {
  const host = document.getElementById("business-products"); host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const products = await Api.get(`/api/business/pages/${businessId}/products`);
    host.innerHTML = products.length ? products.map((item) => `<div class="product-card">${item.image_url && postMediaUrl(item.image_url) ? businessImage(item.image_url,"entity-avatar",item.name) : ""}<div class="product-card-main"><strong>${escapeHtml(item.name)}</strong><p class="feature-subtitle">${escapeHtml(item.description || "")}</p>${item.price ? `<div class="price-tag">${escapeHtml(item.price)}</div>` : ""}</div>${activeBusiness.is_owner ? `<div class="member-row-actions"><button class="btn btn-outline btn-sm" data-edit-product="${item.id}">تعديل</button><button class="btn btn-outline btn-sm" data-delete-product="${item.id}">حذف</button></div>` : ""}</div>`).join("") : '<p class="feature-empty">لا توجد منتجات أو خدمات معروضة بعد.</p>';
    host.querySelectorAll("[data-edit-product]").forEach((btn) => btn.onclick = async () => {
      const item = products.find((p) => p.id === Number(btn.dataset.editProduct)); if (!item) return;
      const name = prompt("اسم المنتج أو الخدمة:", item.name); if (name === null) return;
      const description = prompt("الوصف:", item.description || ""); if (description === null) return;
      const price = prompt("السعر (اختياري):", item.price || ""); if (price === null) return;
      try { await Api.put(`/api/business/products/${item.id}`, { name, description, price: price || null, image_url: item.image_url }); await loadBusinessDetail(); }
      catch (err) { showToast(err.message,"error"); }
    });
    host.querySelectorAll("[data-delete-product]").forEach((btn) => btn.onclick = async () => { if (!confirm("حذف بطاقة المنتج أو الخدمة؟")) return; try { await Api.del(`/api/business/products/${btn.dataset.deleteProduct}`); await loadBusinessDetail(); } catch (err) { showToast(err.message,"error"); } });
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
async function loadBusinessPosts() {
  const host = document.getElementById("business-posts"); host.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const posts = await Api.get(`/api/business/pages/${businessId}/posts?limit=50`);
    host.innerHTML = posts.length ? posts.map(renderPostCard).join("") : '<p class="feature-empty">لا توجد منشورات للنشاط بعد.</p>';
    posts.forEach(bindPostCardEvents);
  } catch (err) { host.innerHTML = `<p class="feature-empty">${escapeHtml(err.message)}</p>`; }
}
window.loadFeed = loadBusinessPosts;

document.getElementById("business-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { const page = await Api.post("/api/business/pages", new FormData(event.currentTarget), true); showToast("تم إنشاء صفحة النشاط","success"); location.href = `business.html?id=${page.id}`; }
  catch (err) { showToast(err.message,"error"); }
});
document.getElementById("business-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await Api.put(`/api/business/pages/${businessId}`, new FormData(event.currentTarget), true); showToast("حُفظت التعديلات","success"); await loadBusinessDetail(); }
  catch (err) { showToast(err.message,"error"); }
});
document.getElementById("business-product-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  try { await Api.post(`/api/business/pages/${businessId}/products`, { name: data.get("name"), description: data.get("description"), price: data.get("price") || null, image_url: data.get("image_url") || null }); form.reset(); showToast("أُضيفت البطاقة","success"); await loadBusinessDetail(); }
  catch (err) { showToast(err.message,"error"); }
});
document.getElementById("business-post-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(); data.set("content", form.elements.content.value); data.set("business_id", String(businessId)); const file = form.elements.media.files[0]; if (file) data.set(file.type.startsWith("video/") ? "video" : "image", file);
  try { await Api.post("/api/posts", data, true); form.reset(); showToast("نُشر تحديث النشاط","success"); await loadBusinessDetail(); }
  catch (err) { showToast(err.message,"error"); }
});

let businessSearchTimer;
document.getElementById("business-search").addEventListener("input", (event) => { clearTimeout(businessSearchTimer); businessSearchTimer = setTimeout(() => loadBusinessList(event.target.value), 250); });
document.getElementById("business-search-btn").addEventListener("click", () => loadBusinessList(document.getElementById("business-search").value));
if (businessId) loadBusinessDetail(); else { loadMyBusinessPage(); loadBusinessList(); }
