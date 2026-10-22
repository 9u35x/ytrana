document.addEventListener("DOMContentLoaded", () => {
  const dialog = document.getElementById("live-demo-dialog");
  const open = document.getElementById("live-demo-open");
  if (!dialog || !open) return;
  const join = document.getElementById("live-join");
  const leave = document.getElementById("live-leave");
  const state = document.getElementById("live-room-state");
  const count = document.getElementById("live-participant-count");
  const simulated = document.getElementById("live-simulate-participant");
  open.addEventListener("click", () => dialog.showModal());
  dialog.querySelector(".live-close").addEventListener("click", () => dialog.close());
  join.addEventListener("click", () => { state.textContent = "دخلت الغرفة التجريبية"; join.disabled = true; leave.disabled = false; });
  leave.addEventListener("click", () => { state.textContent = "الغرفة جاهزة"; join.disabled = false; leave.disabled = true; simulated.checked = false; count.textContent = "1 مشارك محلي"; });
  simulated.addEventListener("change", () => { count.textContent = simulated.checked ? "2 مشاركان محليان" : "1 مشارك محلي"; });
});
