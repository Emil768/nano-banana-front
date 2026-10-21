function bindSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const href = String(anchor.getAttribute("href") || "").trim();
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function bindSectionsRevealAnimation() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      });
    },
    // Порог 0: у высоких секций (каталог промтов на телефоне) 10% не влезает
    // в экран — с порогом 0.1 они бы так и остались прозрачными
    { threshold: 0, rootMargin: "0px 0px -50px 0px" }
  );

  document.querySelectorAll("section").forEach((section) => {
    section.style.opacity = "0";
    section.style.transform = "translateY(20px)";
    section.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    observer.observe(section);
  });
}

function bindPricingButtons() {
  document.querySelectorAll("[data-plan-price]").forEach((button) => {
    button.addEventListener("click", () => {
      void openBillingModal({
        silentPricingErrors: true,
        preferredPrice: Number(button.getAttribute("data-plan-price")),
      });
    });
  });
}

const NANO_TOKEN_KEY = "nano_session_token";
let lastAuthMe = null;
let lastAuthMeAt = 0;
let authMeInFlight = null;
const HOME_MAX_IMAGES = 4;
const HOME_MAX_BASE64_SIZE = 18 * 1024 * 1024;
let homeSelectedFiles = [];

const HOME_VIDEO_POLL_MS = 60_000;
/** ~2 ч макс. ожидания, дальше — остановка с сообщением */
const HOME_VIDEO_MAX_POLL_TICKS = 120;
let homeMode = "photo"; // "photo" | "video"
let homeVideoDuration = "5";
let homeTransparentBg = false;
let homeVideoPollTimer = null;

/**
 * Какой генератор на странице — из <body data-gen>:
 * photo — главная (фото + видео), video — «Оживить фото», bg — «Убрать фон».
 */
const PAGE_GEN = document.body?.dataset.gen || "photo";
const PENDING_PROMPT_KEY = "nano_pending_prompt";
/** Картинка с главной, которую «Оживить фото» переносит на /ozhivit-foto/. */
const ANIMATE_IMAGE_KEY = "nano_animate_image";

/** На «Оживить фото» и «Убрать фон» работаем с одним фото. */
function homeMaxImages() {
  return PAGE_GEN === "photo" ? HOME_MAX_IMAGES : 1;
}

function apiBase() {
  const fromWindow = (
    window.NANO_API_BASE_URL ||
    (window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://127.0.0.1:3000"
      : "https://emil768-nano-banana-api-a16c.twc1.net")
  ).replace(/\/$/, "");
  return fromWindow;
}

function captureSessionTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = String(url.searchParams.get("session") || "").trim();
  if (!token) return;

  try {
    localStorage.setItem(NANO_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }

  url.searchParams.delete("session");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

function getSessionToken() {
  try {
    return localStorage.getItem(NANO_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setHomeStatus(message, kind = "info") {
  const el = document.getElementById("home-gen-status");
  if (!el) return;
  el.textContent = message || "\u00A0";
  el.classList.remove("is-error", "is-success");
  if (kind === "error") el.classList.add("is-error");
  if (kind === "success") el.classList.add("is-success");
}

function setHomeProgressVisible(isVisible) {
  const el = document.getElementById("home-gen-progress");
  if (!el) return;
  el.classList.toggle("hidden", !isVisible);
  el.setAttribute("aria-hidden", isVisible ? "false" : "true");
}

function sanitizeHomeErrorMessage(value) {
  const msg = String(value || "").trim();
  if (!msg) return "";
  return msg
    .replace(/Nano Banana Enterprise/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s—–:]+/, "")
    .trim();
}

const HOME_GENERATION_FAILURE_MESSAGE = `Ошибка генерации.

Вероятные причины:
• сбой сети или сервиса;
• взрослый или запрещённый контент;
• невнятный текст.

Попробуйте ещё раз с другой формулировкой.`;

function resolveHomeGenerationErrorMessage(data, status) {
  const code = data?.code;
  const err = sanitizeHomeErrorMessage(data?.error);
  if (
    code === "GENERATION_FAILED_ALL" ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (err && err.includes("попробуйте"))
  ) {
    return HOME_GENERATION_FAILURE_MESSAGE;
  }
  if (err) return err;
  return HOME_GENERATION_FAILURE_MESSAGE;
}

window.showToast = (message, type = "info") => {
  const t = String(type || "info").toLowerCase();
  const hasStatus = Boolean(document.getElementById("home-gen-status"));
  if (hasStatus) {
    if (t === "error") setHomeStatus(String(message || ""), "error");
    else if (t === "success") setHomeStatus(String(message || ""), "success");
    else setHomeStatus(String(message || ""), "info");
    return;
  }

  const text = String(message || "").trim();
  if (!text) return;
  if (t === "error") console.error(text);
  else if (t === "success") console.info(text);
  else console.log(text);
};

function updateHomeFilesCount() {
  document
    .querySelector("[data-dropzone]")
    ?.classList.toggle("has-file", homeSelectedFiles.length > 0);
  const el = document.getElementById("home-files-count");
  if (!el) return;
  el.textContent = `${homeSelectedFiles.length}/${homeMaxImages()}`;
}

function renderHomePreviews() {
  const grid = document.getElementById("home-preview-grid");
  if (!grid) return;

  grid.innerHTML = "";

  homeSelectedFiles.forEach((file, index) => {
    const card = document.createElement("div");
    card.className = "hero-preview-card";

    const img = document.createElement("img");
    img.className = "hero-preview-image";
    img.alt = `Референс ${index + 1}`;
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "hero-preview-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Удалить фото ${index + 1}`);
    removeButton.addEventListener("click", () => {
      homeSelectedFiles.splice(index, 1);
      updateHomeFilesCount();
      renderHomePreviews();
    });

    card.append(img, removeButton);
    grid.appendChild(card);
  });
}

function fileToJpegBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Не удалось прочитать файл."));
        return;
      }

      const originalDataUrl = reader.result;

      if ((file.type || "").toLowerCase() === "image/jpeg") {
        const base64 = originalDataUrl.split(",")[1] || "";
        if (base64.length > HOME_MAX_BASE64_SIZE) {
          reject(new Error("Файл слишком большой."));
          return;
        }
        resolve({ mimeType: "image/jpeg", data: base64 });
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas недоступен."));
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
        const base64 = jpegDataUrl.split(",")[1] || "";
        if (base64.length > HOME_MAX_BASE64_SIZE) {
          reject(new Error("Файл слишком большой после обработки."));
          return;
        }
        resolve({ mimeType: "image/jpeg", data: base64 });
      };

      img.onerror = () =>
        reject(new Error("Не удалось декодировать изображение."));
      img.src = originalDataUrl;
    };

    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl, baseName) {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(
    String(dataUrl || "").replace(/\s/g, "")
  );
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  try {
    const binStr = atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
    const ext = mime.includes("png")
      ? "png"
      : mime.includes("webp")
      ? "webp"
      : "jpg";
    return new File([bytes], `${baseName}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API недоступен (не https или нет разрешения) — старый способ через скрытое поле
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

function renderHeaderAuthLoading(root) {
  root.textContent = "";
  const s = document.createElement("span");
  s.className = "acc__placeholder";
  s.textContent = "Проверка…";
  root.appendChild(s);
}

function getAuthBalance(data) {
  const balance = Number(data?.balance);
  return Number.isFinite(balance) ? balance : 0;
}

async function logoutSite(button) {
  if (button) button.disabled = true;
  try {
    const token = getSessionToken();
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    // Сбрасываем серверные cookies-сессии (Telegram/Google)
    await fetch(`${apiBase()}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers,
    }).catch(() => null);
  } finally {
    // И локальный токен (query-session) тоже чистим
    try {
      localStorage.removeItem(NANO_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    lastAuthMe = null;
    lastAuthMeAt = 0;
    if (button) button.disabled = false;
    void refreshSiteHeaderAuth();
  }
}

/** Блок аккаунта в сайдбаре: ID, баланс, «Пополнить», выход. */
function renderHeaderAuthed(root, data) {
  root.textContent = "";

  const head = document.createElement("div");
  head.className = "acc__row";

  const id = data?.chat_id;
  const hasId = id != null && id !== "";
  const idLabel = `ID ${id}`;
  const idEl = document.createElement(hasId ? "button" : "span");
  idEl.className = "acc__id";
  idEl.textContent = hasId ? idLabel : "Вы вошли";
  if (hasId) {
    idEl.type = "button";
    idEl.title = "Нажмите, чтобы скопировать ID";
    idEl.setAttribute("aria-label", `Скопировать ${idLabel}`);
    let resetTimer = null;
    idEl.addEventListener("click", async () => {
      const copied = await copyTextToClipboard(String(id));
      idEl.textContent = copied ? "Скопировано" : idLabel;
      idEl.classList.toggle("is-copied", copied);
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        idEl.textContent = idLabel;
        idEl.classList.remove("is-copied");
      }, 1500);
    });
  }

  const gens = document.createElement("span");
  gens.className = "acc__gens";
  gens.textContent = `${getAuthBalance(data)} ⚡`;
  gens.title = "Генераций на балансе";
  head.append(idEl, gens);

  const label = document.createElement("div");
  label.className = "acc__gens-label";
  label.textContent = "Генераций на балансе · общий с ботом";

  const actions = document.createElement("div");
  actions.className = "acc__row";

  const topup = document.createElement("button");
  topup.type = "button";
  topup.className = "b b--y";
  topup.style.flex = "1";
  topup.textContent = "Пополнить";
  topup.addEventListener("click", () => {
    closeSidebar();
    void openBillingModal({ silentPricingErrors: true });
  });

  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "b b--g acc__logout";
  logout.title = "Выйти";
  logout.setAttribute("aria-label", "Выйти");
  logout.innerHTML = `<img src="/assets/images/exit.svg" alt="" width="17" height="17" decoding="async" />`;
  logout.addEventListener("click", () => void logoutSite(logout));

  actions.append(topup, logout);
  root.append(head, label, actions);
}

function renderHeaderGuest(root) {
  root.textContent = "";

  const title = document.createElement("div");
  title.className = "acc__title";
  title.textContent = "Первое фото — бесплатно";

  const note = document.createElement("div");
  note.className = "acc__note";
  note.textContent = "Аккаунт и баланс общие с ботом";

  const login = document.createElement("button");
  login.type = "button";
  login.className = "b b--g b--full";
  login.textContent = "Войти";
  login.addEventListener("click", () => {
    closeSidebar();
    openAuthModal();
  });

  root.append(title, note, login);
}

function renderHeaderAuthError(root) {
  root.textContent = "";
  const s = document.createElement("span");
  s.className = "acc__placeholder";
  s.textContent = "Не удалось проверить вход";
  root.appendChild(s);
}

/** Мобильная шапка: гостю — «Войти», вошедшему — баланс с переходом к оплате. */
function renderMobileAuth(data) {
  const root = document.getElementById("mobile-auth");
  if (!root) return;
  root.textContent = "";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "b b--g b--s";
  if (data) {
    button.textContent = `${getAuthBalance(data)} ⚡`;
    button.setAttribute("aria-label", "Баланс генераций — пополнить");
    button.addEventListener("click", () => {
      void openBillingModal({ silentPricingErrors: true });
    });
  } else {
    button.textContent = "Войти";
    button.addEventListener("click", openAuthModal);
  }
  root.appendChild(button);
}

/* ---------- Светлая / тёмная тема ---------- */

const THEME_KEY = "nano_theme";

function bindThemeToggle() {
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const light = document.documentElement.dataset.theme !== "light";
      if (light) document.documentElement.dataset.theme = "light";
      else delete document.documentElement.dataset.theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", light ? "#fbf9f6" : "#131210");
      try {
        localStorage.setItem(THEME_KEY, light ? "light" : "dark");
      } catch {
        /* приватный режим — тема просто не запомнится */
      }
    });
  });
}

/* ---------- Выдвижное меню (планшет и телефон) ---------- */

function openSidebar() {
  document.getElementById("sidebar")?.classList.add("is-open");
  document.querySelector("[data-sb-close]")?.classList.add("is-open");
  document
    .querySelector("[data-sb-open]")
    ?.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("is-open");
  document.querySelector("[data-sb-close]")?.classList.remove("is-open");
  document
    .querySelector("[data-sb-open]")
    ?.setAttribute("aria-expanded", "false");
}

function bindSidebar() {
  document.querySelector("[data-sb-open]")?.addEventListener("click", openSidebar);
  document.querySelector("[data-sb-close]")?.addEventListener("click", closeSidebar);
  document
    .querySelectorAll("#sidebar a")
    .forEach((link) => link.addEventListener("click", closeSidebar));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });
}

// Billing modal (на главной)
const billingModal = document.getElementById("billing-modal");
const billingModalCloseButton = document.getElementById("billing-modal-close");
const billingModalBackdrop = document.querySelector(
  "[data-close-billing-modal]"
);
const billingPlansEl = document.getElementById("billing-plans");
const billingPayButton = document.getElementById("billing-pay-button");
const billingLoadingEl = document.getElementById("billing-loading");
const billingErrorEl = document.getElementById("billing-error");

let pricingPlans = [];
let selectedPlanId = null;
let isPricingLoading = false;

function setBillingError(message) {
  if (!billingErrorEl) return;
  const text = String(message || "").trim();
  billingErrorEl.textContent = text;
  billingErrorEl.classList.toggle("hidden", !text);
}

function setPricingLoadingState(isLoading) {
  isPricingLoading = isLoading;
  billingLoadingEl?.classList.toggle("hidden", !isLoading);
  if (isLoading) setBillingError("");
  if (billingPayButton) {
    billingPayButton.disabled = isLoading || !selectedPlanId;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPricePerGeneration(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value >= 10 ? Math.round(value).toString() : value.toFixed(1);
}

/* ---------- Промокоды ---------- */

const promoPill = document.getElementById("promo-pill");
const promoPillCode = document.getElementById("promo-pill-code");
const promoPillPercent = document.getElementById("promo-pill-percent");
const promoPillNote = document.getElementById("promo-pill-note");
const promoPillText = document.getElementById("promo-pill-text");
const promoPillTimer = document.getElementById("promo-pill-timer");
const promoToggle = document.getElementById("promo-toggle");
const promoBody = document.getElementById("promo-body");
const promoForm = document.getElementById("promo-form");
const promoInput = document.getElementById("promo-input");
const promoApplyButton = document.getElementById("promo-apply");
const promoAppliedEl = document.getElementById("promo-applied");
const promoAppliedCode = document.getElementById("promo-applied-code");
const promoRemoveButton = document.getElementById("promo-remove");
const promoMessageEl = document.getElementById("promo-message");

/** Код из `/api/promo/active` — тот, что светится пилюлей. */
let activeSitePromo = null;
/** Применённый в модалке код: `{ code, percent }`. */
let appliedPromo = null;
let promoTimerId = null;
let isPromoChecking = false;

/** Неразрывный пробел в разряде: цена не переносится посреди числа. */
function formatRub(value) {
  const amount = Math.round(Number(value) || 0);
  return `${amount.toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
}

/**
 * Копия `applyPromoDiscount` из backend/src/server.js — только для отображения.
 * Сумму платежа считает бэк; формулы обязаны совпадать, иначе показанная
 * цена разойдётся с той, что уйдёт провайдеру.
 */
function applyPromoDiscount(amount, percent) {
  const base = Number(amount || 0);
  const off = Number(percent || 0);

  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(off) || off <= 0) return base;

  return Math.max(1, Math.round((base * (100 - Math.min(off, 100))) / 100));
}

function promoPercent() {
  return appliedPromo ? Number(appliedPromo.percent || 0) : 0;
}

/** Пакеты с `promo_excluded` промокод не удешевляет — так же считает и бэк. */
function planFinalPrice(plan) {
  const basePrice = Number(plan?.price_rub || 0);
  if (plan?.promo_excluded) return basePrice;
  return applyPromoDiscount(basePrice, promoPercent());
}

/**
 * Остаток с подписанными единицами, чтобы не гадать, где что:
 * за неделю это `167 ч 43 мин 39 сек`. Часы копятся через сутки.
 */
function formatPromoCountdown(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");

  return `${pad(hours)} ч ${pad(minutes)} мин ${pad(
    seconds
  )} сек`;
}

function hidePromoPill() {
  if (promoTimerId) {
    clearInterval(promoTimerId);
    promoTimerId = null;
  }
  promoPill?.classList.add("hidden");
  if (promoPill) promoPill.hidden = true;
  if (promoPillNote) promoPillNote.hidden = true;
}

function renderPromoPill() {
  if (!promoPill || !activeSitePromo) return;

  if (promoTimerId) {
    clearInterval(promoTimerId);
    promoTimerId = null;
  }

  const endsAtMs = activeSitePromo.endsAt
    ? Date.parse(activeSitePromo.endsAt)
    : NaN;
  const hasDeadline = Number.isFinite(endsAtMs);

  if (hasDeadline && endsAtMs - Date.now() <= 0) {
    hidePromoPill();
    return;
  }

  // В клетке — только код и процент; продолжение фразы с таймером идёт рядом.
  if (promoPillCode) promoPillCode.textContent = activeSitePromo.code;
  if (promoPillPercent) {
    promoPillPercent.textContent = `−${activeSitePromo.percent}%`;
  }
  if (promoPillText) {
    promoPillText.textContent = hasDeadline ? "осталось" : "";
  }

  const tick = () => {
    const left = endsAtMs - Date.now();
    if (left <= 0) {
      hidePromoPill();
      return;
    }
    if (promoPillTimer) {
      promoPillTimer.textContent = formatPromoCountdown(left);
    }
  };

  if (hasDeadline) {
    tick();
    promoTimerId = setInterval(tick, 1000);
  } else if (promoPillTimer) {
    promoPillTimer.textContent = "";
  }

  promoPill.hidden = false;
  promoPill.classList.remove("hidden");
  // Без срока строка с остатком не нужна вовсе.
  if (promoPillNote) promoPillNote.hidden = !hasDeadline;
}

async function initPromoPill() {
  if (!promoPill) return;

  try {
    const { response, data } = await fetchApiJson("/api/promo/active", {
      method: "GET",
    });
    if (!response.ok) return;

    const promo = data?.promo;
    if (!promo?.code || !Number(promo.percent)) return;

    activeSitePromo = promo;
    renderPromoPill();
  } catch {
    // Пилюля необязательна: молча не показываем.
  }
}

function setPromoMessage(text, kind = "") {
  if (!promoMessageEl) return;
  promoMessageEl.textContent = text || " ";
  promoMessageEl.classList.toggle("is-success", kind === "success");
  promoMessageEl.classList.toggle("is-error", kind === "error");
}

function setPromoChecking(isChecking) {
  isPromoChecking = isChecking;
  if (promoInput) promoInput.disabled = isChecking;
  if (!promoApplyButton) return;

  promoApplyButton.disabled = isChecking;
  promoApplyButton.innerHTML = isChecking
    ? '<span class="inline-loader" aria-hidden="true"></span>Проверяем…'
    : "Применить";
}

function showPromoAppliedState() {
  promoForm?.classList.add("hidden");
  promoAppliedEl?.classList.remove("hidden");
  if (promoAppliedCode && appliedPromo) {
    promoAppliedCode.textContent = appliedPromo.code;
  }
}

function showPromoFormState() {
  promoForm?.classList.remove("hidden");
  promoAppliedEl?.classList.add("hidden");
}

function setPromoEnabled(isEnabled) {
  promoToggle?.setAttribute("aria-checked", isEnabled ? "true" : "false");
  promoBody?.classList.toggle("hidden", !isEnabled);

  if (!isEnabled) {
    appliedPromo = null;
    if (promoInput) promoInput.value = "";
    showPromoFormState();
    setPromoMessage("");
    renderPricingPlans();
    return;
  }

  if (!appliedPromo) promoInput?.focus();
}

/** Сброс к исходному виду — при каждом открытии окна «Пополнение». */
function resetPromoState() {
  appliedPromo = null;
  setPromoChecking(false);
  if (promoInput) promoInput.value = "";
  showPromoFormState();
  setPromoMessage("");
  promoToggle?.setAttribute("aria-checked", "false");
  promoBody?.classList.add("hidden");
}

async function applyPromoCode(rawCode) {
  const code = String(rawCode || "")
    .trim()
    .toUpperCase();

  if (!code) {
    setPromoMessage("Неверный промокод", "error");
    return false;
  }

  setPromoChecking(true);
  setPromoMessage("");

  try {
    const { response, data } = await fetchApiJson("/api/promo/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!response.ok || !data?.valid || !Number(data?.promo?.percent)) {
      appliedPromo = null;
      showPromoFormState();
      setPromoMessage("Неверный промокод", "error");
      renderPricingPlans();
      return false;
    }

    appliedPromo = {
      code: String(data.promo.code || code).toUpperCase(),
      percent: Number(data.promo.percent),
    };
    showPromoAppliedState();
    setPromoMessage(`Промокод применён −${appliedPromo.percent}%`, "success");
    renderPricingPlans();
    return true;
  } catch {
    appliedPromo = null;
    showPromoFormState();
    setPromoMessage("Неверный промокод", "error");
    renderPricingPlans();
    return false;
  } finally {
    setPromoChecking(false);
  }
}

function removeAppliedPromo() {
  appliedPromo = null;
  if (promoInput) promoInput.value = "";
  showPromoFormState();
  setPromoMessage("");
  renderPricingPlans();
  promoInput?.focus();
}

function bindPromoControls() {
  promoPill?.addEventListener("click", () => {
    if (!activeSitePromo) return;
    void openBillingModal({
      silentPricingErrors: true,
      promoCode: activeSitePromo.code,
    });
  });

  promoToggle?.addEventListener("click", () => {
    if (isPromoChecking) return;
    setPromoEnabled(promoToggle.getAttribute("aria-checked") !== "true");
  });

  promoInput?.addEventListener("input", () => {
    const start = promoInput.selectionStart;
    promoInput.value = promoInput.value.toUpperCase();
    promoInput.setSelectionRange(start, start);
    if (promoMessageEl?.classList.contains("is-error")) setPromoMessage("");
  });

  promoInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void applyPromoCode(promoInput.value);
  });

  promoApplyButton?.addEventListener("click", () => {
    if (isPromoChecking) return;
    void applyPromoCode(promoInput?.value);
  });

  promoRemoveButton?.addEventListener("click", removeAppliedPromo);
}

async function fetchApiJson(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const token = getSessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { response, data };
}

function closeBillingModal() {
  if (!billingModal) return;
  billingModal.classList.add("hidden");
  billingModal.setAttribute("aria-hidden", "true");
  setBillingError("");
}

async function openBillingModal(options = {}) {
  if (!billingModal) return;
  setBillingError("");
  resetPromoState();

  const auth = await fetchAuthMeCached({ maxAgeMs: 0 });
  if (!auth) {
    openAuthModal();
    return;
  }

  billingModal.classList.remove("hidden");
  billingModal.setAttribute("aria-hidden", "false");
  await loadPricingPlans(options);

  // Пришли по клику на пилюлю — код уже включён и применён.
  if (options.promoCode) {
    setPromoEnabled(true);
    if (promoInput) promoInput.value = String(options.promoCode).toUpperCase();
    await applyPromoCode(options.promoCode);
  }
}

function updateBillingTotal() {
  const el = document.getElementById("billing-total");
  const oldEl = document.getElementById("billing-total-old");
  if (!el) return;

  const plan = pricingPlans.find(
    (item) => String(item?.id) === String(selectedPlanId)
  );

  if (!plan) {
    el.textContent = "—";
    if (oldEl) oldEl.hidden = true;
    if (billingPayButton) billingPayButton.textContent = "Оплатить";
    return;
  }

  const basePrice = Number(plan.price_rub || 0);
  const finalPrice = planFinalPrice(plan);
  const hasDiscount = finalPrice < basePrice;

  el.textContent = formatRub(finalPrice);

  if (oldEl) {
    oldEl.hidden = !hasDiscount;
    oldEl.textContent = hasDiscount ? `было ${formatRub(basePrice)}` : " ";
  }

  if (billingPayButton) {
    billingPayButton.textContent = `Оплатить ${formatRub(finalPrice)}`;
  }
}

async function loadPricingPlans(options = {}) {
  const { silentPricingErrors = false, preferredPrice } = options;
  if (!billingPlansEl) return;

  setPricingLoadingState(true);
  billingPlansEl.innerHTML = "";

  try {
    const { response, data } = await fetchApiJson(
      "/api/pricing",
      { method: "GET" }
    );

    if (!response.ok) {
      throw new Error(data?.error || "Не удалось загрузить тарифы.");
    }

    pricingPlans = Array.isArray(data?.plans) ? data.plans : [];

    if (!pricingPlans.length) {
      billingPlansEl.innerHTML =
        '<div class="billing-empty">Тарифы временно недоступны.</div>';
      selectedPlanId = null;
      updateBillingTotal();
      return;
    }

    const preferredPlan = pricingPlans.find(
      (plan) => Number(plan?.price_rub) === preferredPrice
    );
    selectedPlanId = (preferredPlan || pricingPlans[0]).id;
    renderPricingPlans();
  } catch {
    pricingPlans = [];
    selectedPlanId = null;
    billingPlansEl.innerHTML =
      '<div class="billing-empty">Не удалось загрузить тарифы.</div>';
    updateBillingTotal();
    if (!silentPricingErrors) setBillingError("Ошибка загрузки тарифов.");
  } finally {
    setPricingLoadingState(false);
  }
}

function renderPricingPlans() {
  if (!billingPlansEl || !pricingPlans.length) return;
  billingPlansEl.innerHTML = "";

  pricingPlans.forEach((plan) => {
    const planId = plan?.id;
    const planName = escapeHtml(plan?.name || "Тариф");
    const generations = Number(plan?.generations || 0);
    const priceRub = Number(plan?.price_rub || 0);
    const finalPrice = planFinalPrice(plan);
    const hasDiscount = finalPrice < priceRub;
    const perGeneration = generations > 0 ? finalPrice / generations : 0;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "billing-plan";
    if (String(planId) === String(selectedPlanId))
      button.classList.add("is-active");

    button.innerHTML = `
      <span class="billing-plan__info">
        <span class="billing-plan__name">${planName}</span>
        <span class="billing-plan__meta">${generations} генераций · ${formatPricePerGeneration(
          perGeneration
        )} ₽ за генерацию</span>
        ${
          plan?.assistant_text
            ? `<span class="billing-plan__ai${
                plan?.assistant_tier ? " is-tier" : ""
              }">${escapeHtml(plan.assistant_text)}</span>`
            : ""
        }
      </span>
      <span class="billing-plan__prices">
        ${
          hasDiscount
            ? `<span class="billing-plan__price-old">${formatRub(
                priceRub
              )}</span>`
            : ""
        }
        <span class="billing-plan__price${
          hasDiscount ? " is-discounted" : ""
        }">${formatRub(finalPrice)}</span>
      </span>
    `;

    button.addEventListener("click", () => {
      selectedPlanId = planId;
      renderPricingPlans();
    });

    billingPlansEl.appendChild(button);
  });

  if (billingPayButton && !isPricingLoading) {
    billingPayButton.disabled = !selectedPlanId;
  }
  updateBillingTotal();
}

async function handlePayClick() {
  if (isPricingLoading) return;
  if (!selectedPlanId) return;

  if (billingPayButton) {
    billingPayButton.disabled = true;
    billingPayButton.textContent = "Переход к оплате...";
  }

  try {
    const { response, data } = await fetchApiJson("/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: selectedPlanId,
        // Сумму не шлём: её считает бэк по этому коду.
        promoCode: appliedPromo?.code || null,
      }),
    });

    if (!response.ok) {
      throw new Error(data?.error || "Не удалось создать платеж.");
    }
    if (!data?.paymentUrl) {
      throw new Error("Провайдер не вернул ссылку на оплату.");
    }

    window.location.href = data.paymentUrl;
  } catch (error) {
    setBillingError(error?.message || "Ошибка оплаты.");
  } finally {
    if (billingPayButton) {
      billingPayButton.disabled = false;
      updateBillingTotal();
    }
  }
}

function bindBillingModal() {
  billingModalCloseButton?.addEventListener("click", closeBillingModal);
  billingModalBackdrop?.addEventListener("click", closeBillingModal);
  billingPayButton?.addEventListener("click", () => void handlePayClick());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeBillingModal();
  });
}

function setGoogleAuthLinks() {
  const redirect = window.location.href;
  const url = `${apiBase()}/auth/google/start?redirect=${encodeURIComponent(
    redirect
  )}`;
  document.getElementById("google-auth-modal-link")?.setAttribute("href", url);
}

function renderTelegramAuthWidget() {
  const host = document.getElementById("telegram-auth-widget");
  if (!host) return;

  host.innerHTML = "";
  const redirect = window.location.href;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://telegram.org/js/telegram-widget.js?22";
  s.setAttribute("data-telegram-login", "nano_bananaa_ai_bot");
  s.setAttribute("data-size", "large");
  s.setAttribute(
    "data-auth-url",
    `${apiBase()}/auth/telegram/callback?redirect=${encodeURIComponent(
      redirect
    )}`
  );
  s.setAttribute("data-request-access", "write");
  host.appendChild(s);
}

function openAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;
  rememberPromptBeforeLogin();
  setGoogleAuthLinks();
  renderTelegramAuthWidget();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function buildFeedbackHref() {
  const params = new URLSearchParams();
  const auth = lastAuthMe;
  const username = String(auth?.user?.username || auth?.username || "")
    .trim()
    .replace(/^@+/, "");
  const chatId = String(auth?.chat_id || "").trim();

  if (username) params.set("username", username);
  if (chatId) params.set("chat_id", chatId);

  const query = params.toString();
  return query ? `/feedback.html?${query}` : "/feedback.html";
}

function openResultModal(imageUrl) {
  const modal = document.getElementById("result-modal");
  const img = document.getElementById("result-modal-image");
  const dl = document.getElementById("result-modal-download");
  const feedbackLink = document.getElementById("result-feedback-cta-link");
  if (!modal || !img || !dl) return;

  img.src = imageUrl;
  dl.href = imageUrl;
  document
    .getElementById("result-modal-animate")
    ?.classList.toggle("hidden", PAGE_GEN !== "photo");
  dl.download = `nano-banana-${Date.now()}.png`;
  if (feedbackLink) feedbackLink.href = buildFeedbackHref();

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeResultModal() {
  const modal = document.getElementById("result-modal");
  const img = document.getElementById("result-modal-image");
  const dl = document.getElementById("result-modal-download");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (img) img.removeAttribute("src");
  if (dl) dl.setAttribute("href", "#");
}

/** «Оживить фото» под результатом: видео делается на отдельной странице — переносим туда картинку. */
function startAnimateFromImage(src) {
  try {
    if (String(src || "").startsWith("data:")) {
      sessionStorage.setItem(ANIMATE_IMAGE_KEY, src);
    }
  } catch {
    /* картинка не влезла в sessionStorage — откроем страницу без неё */
  }
  window.location.href = "/ozhivit-foto/";
}

function bindResultModal() {
  const closeBtn = document.getElementById("result-modal-close");
  const backdrop = document.querySelector("[data-close-result-modal]");
  const animateBtn = document.getElementById("result-modal-animate");
  closeBtn?.addEventListener("click", closeResultModal);
  backdrop?.addEventListener("click", closeResultModal);
  animateBtn?.addEventListener("click", (event) => {
    event.preventDefault();

    const modalImg = document.getElementById("result-modal-image");
    const src = modalImg?.currentSrc || modalImg?.getAttribute("src") || "";
    closeResultModal();
    startAnimateFromImage(src);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeResultModal();
  });
}

function bindAuthModal() {
  const closeBtn = document.getElementById("auth-modal-close");
  const backdrop = document.querySelector("[data-close-auth-modal]");
  closeBtn?.addEventListener("click", closeAuthModal);
  backdrop?.addEventListener("click", closeAuthModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAuthModal();
  });
}

function openHowtoModal() {
  const modal = document.getElementById("howto-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  const video = modal.querySelector("video");
  if (video && !video.src && video.dataset.src) {
    video.src = video.dataset.src;
    video.load();
  }
  video?.play().catch(() => {
    /* автоплей может быть заблокирован — не критично, есть poster */
  });
}

function closeHowtoModal() {
  const modal = document.getElementById("howto-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  modal.querySelector("video")?.pause();
}

function bindHowtoModal() {
  const openBtn = document.getElementById("howto-button");
  const closeBtn = document.getElementById("howto-modal-close");
  const backdrop = document.querySelector("[data-close-howto-modal]");
  openBtn?.addEventListener("click", openHowtoModal);
  closeBtn?.addEventListener("click", closeHowtoModal);
  backdrop?.addEventListener("click", closeHowtoModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeHowtoModal();
  });
}

/** id новости, которую юзер уже закрыл: пока он тот же — модалку не показываем. */
const NEWS_SEEN_KEY = "nano_news_seen";

function closeNewsModal() {
  const modal = document.getElementById("news-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  try {
    localStorage.setItem(NEWS_SEEN_KEY, modal.dataset.newsId || "");
  } catch {
    /* ignore */
  }
}

/** Модалка со скрином свежего поста из канала (публикует scripts/publish_news.py). */
async function initNewsModal() {
  const modal = document.getElementById("news-modal");
  const image = document.getElementById("news-modal-image");
  if (!modal || !image) return;

  try {
    // Новости — только тем, кто вошёл: гостю, впервые открывшему сайт, они ни к чему
    const auth = await fetchAuthMeCached({ maxAgeMs: 15000 });
    if (!auth) return;

    const { response, data } = await fetchApiJson("/api/news/active", {
      method: "GET",
    });
    const news = data?.news;
    if (!response.ok || !news?.id || !news.link || !news.image) return;

    let seen = "";
    try {
      seen = localStorage.getItem(NEWS_SEEN_KEY) || "";
    } catch {
      /* ignore */
    }
    if (seen === String(news.id)) return;

    modal.dataset.newsId = String(news.id);
    const link = document.getElementById("news-modal-link");
    link.textContent = news.link.replace(/^https?:\/\//, "");
    for (const a of modal.querySelectorAll("a[href]")) a.href = news.link;

    // Показываем только когда скрин загрузился — пустую модалку не светим.
    image.addEventListener(
      "load",
      () => {
        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");
      },
      { once: true }
    );
    image.src = `${apiBase()}${news.image}`;

    for (const el of modal.querySelectorAll("[data-close-news-modal]")) {
      el.addEventListener("click", closeNewsModal);
    }
    // Перешёл в канал — значит увидел.
    for (const a of modal.querySelectorAll("a[href]")) {
      a.addEventListener("click", closeNewsModal);
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeNewsModal();
    });
  } catch {
    // Новость необязательна: молча не показываем.
  }
}

async function fetchAuthMeCached({ maxAgeMs = 15000 } = {}) {
  const now = Date.now();
  if (lastAuthMeAt && now - lastAuthMeAt <= maxAgeMs) return lastAuthMe;
  if (authMeInFlight) return authMeInFlight;

  const token = getSessionToken();
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  authMeInFlight = (async () => {
    try {
      const response = await fetch(`${apiBase()}/auth/me`, {
        method: "GET",
        credentials: "include",
        headers,
      });

      if (response.status === 401 || response.status === 403) {
        lastAuthMe = null;
        lastAuthMeAt = Date.now();
        return null;
      }

      if (!response.ok) {
        lastAuthMe = null;
        lastAuthMeAt = Date.now();
        return null;
      }

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      lastAuthMe = data && typeof data === "object" ? data : null;
      lastAuthMeAt = Date.now();
      return lastAuthMe;
    } catch {
      lastAuthMe = null;
      lastAuthMeAt = Date.now();
      return null;
    } finally {
      authMeInFlight = null;
    }
  })();

  return authMeInFlight;
}

async function refreshSiteHeaderAuth() {
  const root = document.getElementById("site-header-auth");
  if (!root) return;

  renderHeaderAuthLoading(root);
  captureSessionTokenFromUrl();
  try {
    const data = await fetchAuthMeCached({ maxAgeMs: 0 });
    if (data) renderHeaderAuthed(root, data);
    else renderHeaderGuest(root);
    renderMobileAuth(data);
  } catch {
    renderHeaderAuthError(root);
    renderMobileAuth(null);
  }
}

function extractFirstImagePayload(responseData) {
  if (!responseData || typeof responseData !== "object") return null;

  if (typeof responseData.imageData === "string" && responseData.imageData) {
    return { data: responseData.imageData, mimeType: "image/png" };
  }

  if (Array.isArray(responseData.images) && responseData.images.length) {
    const item = responseData.images[0];
    if (typeof item === "string" && item)
      return { data: item, mimeType: "image/png" };
    if (item && typeof item === "object") {
      const data = item.data;
      const mimeType = item.mimeType || item.mimetype || "image/png";
      if (typeof data === "string" && data) return { data, mimeType };
    }
  }

  const candidates = Array.isArray(responseData?.candidates)
    ? responseData.candidates
    : Array.isArray(responseData?.data?.candidates)
    ? responseData.data.candidates
    : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];
    for (const part of parts) {
      const inline = part?.inline_data || part?.inlineData;
      const data = inline?.data;
      const mimeType = inline?.mime_type || inline?.mimeType || "image/png";
      if (typeof data === "string" && data) return { data, mimeType };
    }
  }

  return null;
}

async function generateHomeImage(prompt) {
  const token = getSessionToken();
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const auth = await fetchAuthMeCached({ maxAgeMs: 15000 });
  if (!auth) {
    openAuthModal();
    return { ok: false, code: "UNAUTH" };
  }

  const imagesPayload = await Promise.all(
    homeSelectedFiles.map(async (file) => await fileToJpegBase64(file))
  );

  const payload = {
    prompt,
  };
  if (homeTransparentBg) {
    payload.transparentBackground = true;
  }
  // «Убрать фон»: без запасных моделей — если GPT не справился, бэк честно откажет
  if (PAGE_GEN === "bg") {
    payload.gptOnly = true;
  }
  if (imagesPayload.length === 1) {
    payload.image = imagesPayload[0];
  } else if (imagesPayload.length > 1) {
    payload.images = imagesPayload;
  }

  const response = await fetch(`${apiBase()}/api/generate-image`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return { ok: response.ok, status: response.status, data };
}

function hideHomeDownloadLink() {
  const downloadLink = document.getElementById("home-result-download");
  if (!downloadLink) return;
  downloadLink.classList.add("hidden");
  downloadLink.setAttribute("href", "#");
}

function showHomeResultPanel(kind) {
  document.getElementById("home-result-panel")?.classList.remove("hidden");
  document
    .getElementById("home-result-animate")
    ?.classList.toggle("hidden", kind !== "photo" || PAGE_GEN !== "photo");
  const feedbackLink = document.getElementById("home-result-feedback");
  if (feedbackLink) feedbackLink.href = buildFeedbackHref();
  // Результат ниже формы — без прокрутки юзер не заметит, что всё готово
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("home-result-panel")?.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

function resetHomeResult() {
  const img = document.getElementById("home-result");
  const video = document.getElementById("home-result-video");
  img?.classList.add("hidden");
  img?.removeAttribute("src");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.classList.add("hidden");
  }
  hideHomeDownloadLink();
  document.getElementById("home-result-panel")?.classList.add("hidden");
}

function getHomeVideoCost(durationRaw) {
  return String(durationRaw) === "10" ? 20 : 10;
}

function updateHomeCreateButtonLabel() {
  const btn = document.getElementById("home-generate");
  if (!btn || btn.disabled) return;
  const cost =
    homeMode === "video"
      ? getHomeVideoCost(homeVideoDuration)
      : 1;
  const label = btn.dataset.label || "Создать";
  btn.innerHTML = `${label} <span class="gen-submit__cost">${cost} ⚡</span>`;
}

function setSegmentActive(options) {
  options.forEach(([id, isActive]) => {
    const el = document.getElementById(id);
    el?.classList.toggle("is-active", isActive);
    el?.setAttribute("aria-checked", String(isActive));
  });
}

function setHomeVideoDuration(value) {
  homeVideoDuration = String(value) === "10" ? "10" : "5";
  setSegmentActive([
    ["home-video-duration-5", homeVideoDuration === "5"],
    ["home-video-duration-10", homeVideoDuration === "10"],
  ]);
  updateHomeCreateButtonLabel();
}

function setHomeTransparentBg(value) {
  homeTransparentBg = Boolean(value);
  document
    .getElementById("home-photo-transparent")
    ?.setAttribute("aria-checked", String(homeTransparentBg));
}

function setHomeMode(mode) {
  homeMode = mode === "video" ? "video" : "photo";
  const isVideo = homeMode === "video";


  document
    .getElementById("home-mode-toggle-photo")
    ?.classList.toggle("is-active", !isVideo);
  document
    .getElementById("home-mode-toggle-photo")
    ?.setAttribute("aria-selected", String(!isVideo));
  document
    .getElementById("home-mode-toggle-video")
    ?.classList.toggle("is-active", isVideo);
  document
    .getElementById("home-mode-toggle-video")
    ?.setAttribute("aria-selected", String(isVideo));

  document
    .getElementById("home-video-controls")
    ?.classList.toggle("hidden", !isVideo);
  document
    .getElementById("home-photo-transparent")
    ?.classList.toggle("hidden", isVideo);
  document.querySelectorAll("[data-chips-mode]").forEach((group) => {
    group.classList.toggle(
      "hidden",
      group.getAttribute("data-chips-mode") !== homeMode
    );
  });

  resetHomeResult();
  setHomeStatus(" ", "info");
  updateHomeCreateButtonLabel();
}

function clearHomeVideoPoll() {
  if (homeVideoPollTimer !== null) {
    window.clearTimeout(homeVideoPollTimer);
    homeVideoPollTimer = null;
  }
}

async function generateHomeVideo(prompt) {
  const token = getSessionToken();
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const auth = await fetchAuthMeCached({ maxAgeMs: 15000 });
  if (!auth) {
    openAuthModal();
    return { ok: false, code: "UNAUTH" };
  }

  const imagePayload = await fileToJpegBase64(homeSelectedFiles[0]);

  const response = await fetch(`${apiBase()}/api/generate-video/start`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      prompt,
      duration: homeVideoDuration,
      imageBase64: imagePayload.data,
      mimeType: imagePayload.mimeType || "image/jpeg",
    }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return { ok: response.ok, status: response.status, data };
}

function pollHomeVideoStatus(taskId) {
  clearHomeVideoPoll();
  let tickCount = 0;

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        tickCount += 1;
        if (tickCount > HOME_VIDEO_MAX_POLL_TICKS) {
          clearHomeVideoPoll();
          resolve({ timedOut: true });
          return;
        }

        const { response, data } = await fetchApiJson(
          `/api/generate-video/status?taskId=${encodeURIComponent(taskId)}`,
          { method: "GET" }
        );

        if (!response.ok) {
          if (
            response.status === 402 ||
            data?.code === "INSUFFICIENT_BALANCE"
          ) {
            reject(new Error("INSUFFICIENT_BALANCE"));
            return;
          }
          reject(new Error(data?.error || "Ошибка статуса видео."));
          return;
        }

        if (data?.state === "success" && data?.videoUrl) {
          clearHomeVideoPoll();
          resolve({ videoUrl: data.videoUrl });
          return;
        }

        if (data?.state === "failed") {
          clearHomeVideoPoll();
          reject(new Error(data?.error || "Ошибка генерации видео."));
          return;
        }

        homeVideoPollTimer = window.setTimeout(tick, HOME_VIDEO_POLL_MS);
      } catch (error) {
        clearHomeVideoPoll();
        reject(error);
      }
    };

    homeVideoPollTimer = window.setTimeout(tick, 0);
  });
}

/**
 * `/?prompt=…` со страниц промтов. Параметр убираем из адреса — обычная
 * перезагрузка его больше не вернёт. Промт переживает только вход через
 * Telegram/Google: openAuthModal кладёт его в sessionStorage, а здесь мы
 * забираем его один раз и сразу стираем.
 */
function takePromptFromUrl() {
  const url = new URL(window.location.href);
  const fromUrl = String(url.searchParams.get("prompt") || "").trim().slice(0, 4000);

  let pending = "";
  try {
    pending = sessionStorage.getItem(PENDING_PROMPT_KEY) || "";
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
  } catch {
    /* ignore */
  }

  if (fromUrl) {
    url.searchParams.delete("prompt");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return fromUrl;
  }
  return pending;
}

/** Перед входом (страница перезагрузится) — сохранить набранный промт. */
function rememberPromptBeforeLogin() {
  const text = String(document.getElementById("prompt")?.value || "").trim();
  if (!text || PAGE_GEN !== "photo") return;
  try {
    sessionStorage.setItem(PENDING_PROMPT_KEY, text);
  } catch {
    /* ignore */
  }
}

function clearPendingPrompt() {
  try {
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
  } catch {
    /* ignore */
  }
}

/** Промт для «Убрать фон»: всегда прозрачный PNG. Нет фото — генерацию не запускаем. */
function resolveBgPrompt() {
  if (!homeSelectedFiles.length) {
    setHomeStatus("Загрузите фото, с которого нужно убрать фон.", "error");
    return "";
  }
  return "Удали фон полностью, оставь только главный объект на прозрачном фоне. Главный объект (человека или предмет) оставь без изменений: форма, цвета, детали, края и волосы.";
}

/** Зона «Перетащите фото сюда» на «Оживить фото» и «Убрать фон». */
function bindHomeDropzone(fileInput, addFiles) {
  const zone = document.querySelector("[data-dropzone]");
  if (!zone) return;

  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      stop(event);
      zone.classList.add("is-over");
    })
  );
  zone.addEventListener("dragleave", (event) => {
    if (zone.contains(event.relatedTarget)) return;
    zone.classList.remove("is-over");
  });
  zone.addEventListener("drop", (event) => {
    stop(event);
    zone.classList.remove("is-over");
    const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
      String(file.type || "").startsWith("image/")
    );
    if (files.length) addFiles(files);
    else window.showToast("Перетащите картинку: JPG, PNG или WebP.", "warning");
  });
  // Клик по пустой зоне — тот же выбор файла, что и кнопка
  zone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (!homeSelectedFiles.length) fileInput.click();
  });
}

function bindHomeGenerator() {
  const promptEl = document.getElementById("prompt");
  const btn = document.getElementById("home-generate");
  const img = document.getElementById("home-result");
  const videoEl = document.getElementById("home-result-video");
  const fileInput = document.getElementById("home-images");
  const attachBtn = document.getElementById("home-attach");
  const modeTogglePhoto = document.getElementById("home-mode-toggle-photo");
  const modeToggleVideo = document.getElementById("home-mode-toggle-video");
  if (!promptEl || !btn || !img || !fileInput || !attachBtn) return;

  // Подпись кнопки своя на каждой странице («Создать», «Оживить фото»…) —
  // запоминаем до того, как к ней допишется цена
  btn.dataset.label = btn.textContent.trim() || "Создать";

  const autoGrowPrompt = () => {
    promptEl.style.height = "auto";
    promptEl.style.height = `${promptEl.scrollHeight}px`;
  };
  promptEl.addEventListener("input", autoGrowPrompt);

  const setLoading = (on) => {
    btn.disabled = !!on;
    btn.classList.toggle("is-loading", !!on);
    btn.textContent = on ? "Генерируем…" : btn.dataset.label || "Создать";
    if (!on) updateHomeCreateButtonLabel();
    setHomeProgressVisible(!!on);
    attachBtn.disabled = !!on;
    if (modeTogglePhoto) modeTogglePhoto.disabled = !!on;
    if (modeToggleVideo) modeToggleVideo.disabled = !!on;
  };

  const runPhoto = async () => {
    let prompt = "";
    if (PAGE_GEN === "bg") {
      prompt = resolveBgPrompt();
      if (!prompt) return;
    } else {
      prompt = String(promptEl.value || "").trim();
      if (!prompt) {
        promptEl.setCustomValidity("Введите текст промпта.");
        promptEl.reportValidity();
        return;
      }
      promptEl.setCustomValidity("");
    }

    setLoading(true);
    resetHomeResult();
    setHomeStatus("Генерация на сервере: обычно до 1–2 минут…", "info");

    try {
      const result = await generateHomeImage(prompt);

      if (
        result?.code === "UNAUTH" ||
        result?.status === 401 ||
        result?.status === 403
      ) {
        setHomeStatus("\u00A0", "info");
        openAuthModal();
        void refreshSiteHeaderAuth();
        return;
      }

      if (
        result?.status === 402 ||
        result?.data?.code === "INSUFFICIENT_BALANCE"
      ) {
        setHomeStatus("\u00A0", "info");
        void openBillingModal({ silentPricingErrors: true });
        return;
      }

      if (
        result?.status === 422 &&
        (result?.data?.code === "GENERATION_SAFETY" ||
          result?.data?.code === "MISSING_IMAGE_DATA")
      ) {
        window.showToast(
          result?.data?.error || "Запрос не выполнен.",
          "error"
        );
        return;
      }

      if (result?.status === 422) {
        window.showToast(
          result?.data?.error || "Запрос не прошёл проверку.",
          "error"
        );
        return;
      }

      if (!result || !result.ok) {
        const msg = resolveHomeGenerationErrorMessage(
          result?.data,
          result?.status
        );
        window.showToast(msg, "error");
        return;
      }

      setHomeStatus("\u00A0", "info");
      clearPendingPrompt();

      if (
        Array.isArray(result.data?.reconnectNotices) &&
        result.data.reconnectNotices.length
      ) {
        window.showToast(result.data.reconnectNotices.join(" "), "info");
      }

      const first = extractFirstImagePayload(result.data);
      if (!first) {
        window.showToast(
          "Сервер не вернул изображение. Попробуйте ещё раз.",
          "error"
        );
        return;
      }

      const dataUrl = `data:${first.mimeType};base64,${first.data}`;
      img.src = dataUrl;
      img.classList.remove("hidden");

      const downloadLink = document.getElementById("home-result-download");
      if (downloadLink) {
        const mime = String(first.mimeType || "image/png").toLowerCase();
        const ext =
          mime.includes("jpeg") || mime.includes("jpg")
            ? "jpg"
            : mime.includes("webp")
            ? "webp"
            : mime.includes("png")
            ? "png"
            : "png";
        downloadLink.href = dataUrl;
        downloadLink.download = `nano-banana-${Date.now()}.${ext}`;
        downloadLink.classList.remove("hidden");
      }

      showHomeResultPanel("photo");
      openResultModal(dataUrl);
      void refreshSiteHeaderAuth();
    } catch (error) {
      const raw = String(error?.message || "");
      const netFail = /failed to fetch|load failed|network/i.test(
        raw.toLowerCase()
      );
      window.showToast(
        netFail
          ? "Не удалось связаться с сервером. Проверьте сеть и попробуйте снова."
          : raw || "Ошибка генерации.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const runVideo = async () => {
    const prompt = String(promptEl.value || "").trim();
    if (!prompt) {
      promptEl.setCustomValidity("Введите текст промпта.");
      promptEl.reportValidity();
      return;
    }
    promptEl.setCustomValidity("");

    if (!homeSelectedFiles.length) {
      window.showToast("Прикрепите фото-референс для видео.", "warning");
      return;
    }

    setLoading(true);
    resetHomeResult();
    setHomeStatus("Создаём задачу на видео…", "info");

    try {
      const start = await generateHomeVideo(prompt);

      if (
        start?.code === "UNAUTH" ||
        start?.status === 401 ||
        start?.status === 403
      ) {
        setHomeStatus(" ", "info");
        openAuthModal();
        void refreshSiteHeaderAuth();
        return;
      }

      if (
        start?.status === 402 ||
        start?.data?.code === "INSUFFICIENT_BALANCE"
      ) {
        setHomeStatus(" ", "info");
        void openBillingModal({ silentPricingErrors: true });
        return;
      }

      if (start?.status === 422) {
        window.showToast(
          start?.data?.error || "Запрос не прошёл проверку.",
          "error"
        );
        return;
      }

      if (!start || !start.ok) {
        window.showToast(
          start?.data?.error || "Не удалось запустить генерацию видео.",
          "error"
        );
        return;
      }

      const taskId = start.data?.taskId;
      if (!taskId) {
        window.showToast("Сервер не вернул идентификатор задачи.", "error");
        return;
      }

      setHomeStatus("Видео создаётся, обычно 2–5 минут…", "info");

      const result = await pollHomeVideoStatus(taskId);

      if (result?.timedOut) {
        setHomeStatus(" ", "info");
        window.showToast(
          "Превышено время ожидания видео. Попробуйте проверить позже.",
          "error"
        );
        return;
      }

      setHomeStatus(" ", "info");

      if (videoEl && result?.videoUrl) {
        videoEl.src = result.videoUrl;
        videoEl.classList.remove("hidden");
      }

      const downloadLink = document.getElementById("home-result-download");
      if (downloadLink && result?.videoUrl) {
        downloadLink.href = result.videoUrl;
        downloadLink.download = `nano-banana-video-${Date.now()}.mp4`;
        downloadLink.classList.remove("hidden");
      }

      if (result?.videoUrl) showHomeResultPanel("video");
      void refreshSiteHeaderAuth();
    } catch (error) {
      const msg = String(error?.message || "");
      if (msg === "INSUFFICIENT_BALANCE") {
        void openBillingModal({ silentPricingErrors: true });
        window.showToast(
          "Недостаточно генераций. Пополните баланс.",
          "warning"
        );
      } else {
        window.showToast(msg || "Ошибка генерации видео.", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const runCurrent = () => (homeMode === "video" ? runVideo() : runPhoto());

  attachBtn.addEventListener("click", () => {
    fileInput.click();
  });

  const addHomeFiles = (incoming) => {
    if (!incoming.length) return;
    const max = homeMaxImages();
    homeSelectedFiles =
      max === 1
        ? incoming.slice(0, 1)
        : [...homeSelectedFiles, ...incoming].slice(0, max);
    updateHomeFilesCount();
    renderHomePreviews();
  };

  fileInput.addEventListener("change", (event) => {
    addHomeFiles(Array.from(event.target.files || []));
    fileInput.value = "";
  });

  bindHomeDropzone(fileInput, addHomeFiles);

  document.addEventListener("paste", (event) => {
    if (btn.disabled) return;
    const items = event.clipboardData?.items;
    if (!items || !items.length) return;

    const imageFiles = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (!imageFiles.length) return;

    event.preventDefault();
    addHomeFiles(imageFiles);
    window.showToast(
      imageFiles.length > 1
        ? "Изображения вставлены из буфера обмена."
        : "Изображение вставлено из буфера обмена.",
      "success"
    );
  });

  document
    .getElementById("home-video-duration-5")
    ?.addEventListener("click", () => setHomeVideoDuration("5"));
  document
    .getElementById("home-video-duration-10")
    ?.addEventListener("click", () => setHomeVideoDuration("10"));

  // Подсказки-кусочки промта: тексты разделяем запятой
  const promptParts = () =>
    String(promptEl.value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  const syncAppendChips = () => {
    const parts = promptParts();
    document.querySelectorAll("[data-chips-append] .chip").forEach((chip) => {
      const on = parts.includes(chip.getAttribute("data-prompt") || "");
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-pressed", String(on));
    });
  };

  document.querySelectorAll("[data-chips-mode] .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const text = chip.getAttribute("data-prompt") || "";
      if (chip.closest("[data-chips-append]")) {
        // «Оживить фото»: подсказки складываются, повторный клик убирает
        const parts = promptParts();
        promptEl.value = (
          parts.includes(text)
            ? parts.filter((part) => part !== text)
            : [...parts, text]
        ).join(", ");
        syncAppendChips();
      } else {
        promptEl.value = text;
      }
      promptEl.setCustomValidity("");
      autoGrowPrompt();
      promptEl.focus();
    });
  });
  promptEl.addEventListener("input", syncAppendChips);

  document
    .getElementById("home-result-reset")
    ?.addEventListener("click", resetHomeResult);
  document
    .getElementById("home-result-animate")
    ?.addEventListener("click", () =>
      startAnimateFromImage(img.getAttribute("src") || "")
    );
  img.addEventListener("click", () => {
    const src = img.getAttribute("src");
    if (src) openResultModal(src);
  });
  document
    .getElementById("home-photo-transparent")
    ?.addEventListener("click", () => setHomeTransparentBg(!homeTransparentBg));

  modeTogglePhoto?.addEventListener("click", () => {
    if (btn.disabled) return;
    setHomeMode("photo");
  });
  modeToggleVideo?.addEventListener("click", () => {
    if (btn.disabled) return;
    setHomeMode("video");
  });

  updateHomeFilesCount();
  renderHomePreviews();
  setHomeVideoDuration("5");

  // Главная и «Убрать фон» — только фото, видео — на «Оживить фото»
  setHomeMode(PAGE_GEN === "video" ? "video" : "photo");

  const pendingPrompt = PAGE_GEN === "photo" ? takePromptFromUrl() : "";
  // «Убрать фон» — всегда прозрачный PNG
  if (PAGE_GEN === "bg") setHomeTransparentBg(true);

  if (PAGE_GEN === "video") {
    let carried = "";
    try {
      carried = sessionStorage.getItem(ANIMATE_IMAGE_KEY) || "";
      sessionStorage.removeItem(ANIMATE_IMAGE_KEY);
    } catch {
      /* ignore */
    }
    const file = carried ? dataUrlToFile(carried, "nano-reference") : null;
    if (file) addHomeFiles([file]);
  }

  if (pendingPrompt) {
    promptEl.value = pendingPrompt;
    autoGrowPrompt();
    promptEl.focus({ preventScroll: true });

    // Промт с [местом для замены] — выделяем первое, чтобы сразу вписать своё
    const slot = /\[[^\]]+\]/.exec(pendingPrompt);
    if (slot) {
      promptEl.setSelectionRange(slot.index, slot.index + slot[0].length);
      setHomeStatus(
        "Замените текст в [скобках] на своё — он уже выделен, просто печатайте.",
        "info"
      );
    }
  }

  btn.addEventListener("click", () => void runCurrent());
  promptEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.isComposing) return;
    if (event.shiftKey) return;
    event.preventDefault();
    void runCurrent();
  });
}

function bindFaqAccordion() {
  const root = document.querySelector("[data-faq-accordion]");
  if (!root) return;

  root.querySelectorAll(".faq-item").forEach((item) => {
    const trigger = item.querySelector(".faq-item__trigger");
    if (!trigger) return;

    trigger.addEventListener("click", () => {
      const willOpen = !item.classList.contains("is-open");

      root.querySelectorAll(".faq-item.is-open").forEach((openItem) => {
        if (openItem === item) return;
        openItem.classList.remove("is-open");
        openItem
          .querySelector(".faq-item__trigger")
          ?.setAttribute("aria-expanded", "false");
      });

      item.classList.toggle("is-open", willOpen);
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindSmoothScroll();
  bindSectionsRevealAnimation();
  bindPricingButtons();
  setGoogleAuthLinks();
  bindAuthModal();
  bindHowtoModal();
  bindResultModal();
  bindBillingModal();
  bindPromoControls();
  void initPromoPill();
  void initNewsModal();
  bindFaqAccordion();
  bindSidebar();
  bindThemeToggle();
  void refreshSiteHeaderAuth();
  bindHomeGenerator();
});
