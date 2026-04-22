(function () {
  /** Автопоказ модалки один раз на весь период акции (между index и generate общий ключ) */
  const AUTO_SHOWN_KEY = "nano_gift_promo_auto_shown_2026_04";
  /** Показываем до конца 4 апреля 2026 (локальное время): скрываем с 5 апреля 00:00 */
  const PROMO_END = new Date(2027, 3, 5);
  const FAB_CLASS = "gift-promo-fab";

  function isCampaignActive() {
    return Date.now() < PROMO_END.getTime();
  }

  function hasAutoShownModal() {
    try {
      return localStorage.getItem(AUTO_SHOWN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function markAutoShown() {
    try {
      localStorage.setItem(AUTO_SHOWN_KEY, "1");
    } catch (_) {}
  }

  function hideModal() {
    const el = document.getElementById("gift-promo-modal");
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }

  function showModal() {
    const el = document.getElementById("gift-promo-modal");
    if (!el) return;
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    hideModal();
  }

  function createFab() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = FAB_CLASS;
    btn.setAttribute("aria-label", "Акция");
    btn.textContent = "Акция";
    btn.addEventListener("click", showModal);
    document.body.appendChild(btn);
  }

  function init() {
    const modal = document.getElementById("gift-promo-modal");
    if (!modal) return;

    hideModal();

    if (!isCampaignActive()) return;

    createFab();

    if (!hasAutoShownModal()) {
      showModal();
      markAutoShown();
    }

    const closeBtn = document.getElementById("gift-promo-modal-close");
    const backdrop = document.querySelector("[data-close-gift-promo]");
    closeBtn?.addEventListener("click", closeModal);
    backdrop?.addEventListener("click", closeModal);
    document.addEventListener("keydown", function onEscape(ev) {
      if (ev.key !== "Escape") return;
      if (modal.classList.contains("hidden")) return;
      closeModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
