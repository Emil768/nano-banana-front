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
    { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
  );

  document.querySelectorAll("section").forEach((section) => {
    section.style.opacity = "0";
    section.style.transform = "translateY(20px)";
    section.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    observer.observe(section);
  });
}

function bindPricingTabs() {
  const pricingTabsContainer = document.querySelector(".pricing-tabs");
  if (!pricingTabsContainer) return;

  pricingTabsContainer.addEventListener("click", (event) => {
    const clickedTab = event.target.closest(".pricing-tab");
    if (!clickedTab) return;

    event.preventDefault();
    const targetTab = clickedTab.getAttribute("data-tab");
    const targetContent = document.getElementById(`${targetTab}-tab`);
    if (!targetContent) return;

    document
      .querySelectorAll(".pricing-tab")
      .forEach((el) => el.classList.remove("active"));
    document
      .querySelectorAll(".pricing-tab-content")
      .forEach((el) => el.classList.remove("active"));

    clickedTab.classList.add("active");
    targetContent.classList.add("active");
  });
}

const NANO_TOKEN_KEY = "nano_session_token";
let lastAuthMe = null;
let lastAuthMeAt = 0;
let authMeInFlight = null;
const HOME_MAX_IMAGES = 4;
const HOME_MAX_BASE64_SIZE = 18 * 1024 * 1024;
let homeSelectedFiles = [];

function apiBase() {
  const fromWindow = (
    window.NANO_API_BASE_URL ||
    (window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://127.0.0.1:3000"
      : "https://nanobananaa.up.railway.app")
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
  const el = document.getElementById("home-files-count");
  if (!el) return;
  el.textContent = `${homeSelectedFiles.length}/${HOME_MAX_IMAGES}`;
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

function renderHeaderAuthLoading(root) {
  root.textContent = "";
  const s = document.createElement("span");
  s.className = "site-header__auth-placeholder";
  s.textContent = "Проверка…";
  root.appendChild(s);
}

function renderHeaderAuthed(root, data) {
  root.textContent = "";
  const row = document.createElement("div");
  row.className = "site-header__user";

  const img = document.createElement("img");
  img.className = "site-header__user-ico";
  img.src = "/assets/images/telegram.gif";
  img.width = 26;
  img.height = 26;
  img.alt = "";
  img.decoding = "async";

  const idSpan = document.createElement("span");
  idSpan.className = "site-header__user-id";
  const id = data?.chat_id;
  idSpan.textContent = id != null && id !== "" ? `ID ${id}` : "Авторизован";

  const balance = Number(
    String(data?.version || data?.user?.version || "").toLowerCase() === "free"
      ? data?.balance_free
      : data?.balance
  );
  const gens = Number.isFinite(balance) ? balance : 0;

  const gensSpan = document.createElement("span");
  gensSpan.className = "site-header__gens";
  gensSpan.textContent = `${gens} ⚡️`;

  const topup = document.createElement("button");
  topup.type = "button";
  topup.className = "site-header__topup";
  topup.innerHTML = `Пополнить <img class="site-header__sbp" src="/assets/images/sbp.svg" alt="СБП" decoding="async" />`;
  topup.addEventListener("click", async () => {
    await openBillingModal({ silentPricingErrors: true });
  });

  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "site-header__logout";
  logout.setAttribute("aria-label", "Выйти");
  logout.innerHTML = `<img src="/assets/images/exit.svg" alt="" width="18" height="18" decoding="async" />`;
  logout.addEventListener("click", async () => {
    logout.disabled = true;
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
      logout.disabled = false;
      void refreshSiteHeaderAuth();
    }
  });

  row.append(img, idSpan, gensSpan, topup, logout);
  root.appendChild(row);
}

function renderHeaderGuest(root) {
  root.textContent = "";
  const row = document.createElement("div");
  row.className = "site-header__guest";

  const login = document.createElement("button");
  login.type = "button";
  login.className = "site-header__topup";
  login.textContent = "Войти";
  login.addEventListener("click", () => {
    openAuthModal();
  });

  row.appendChild(login);
  root.appendChild(row);
}

function renderHeaderAuthError(root) {
  root.textContent = "";
  const s = document.createElement("span");
  s.className = "site-header__auth-placeholder";
  s.textContent = "Не удалось проверить вход";
  root.appendChild(s);
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
let billingSelectedVersion = "pro";
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

  const auth = await fetchAuthMeCached({ maxAgeMs: 0 });
  if (!auth) {
    openAuthModal();
    return;
  }

  billingSelectedVersion =
    String(auth?.version || auth?.user?.version || "").toLowerCase() === "free"
      ? "free"
      : "pro";

  billingModal.classList.remove("hidden");
  billingModal.setAttribute("aria-hidden", "false");
  await loadPricingPlans(options);
}

async function loadPricingPlans(options = {}) {
  const { silentPricingErrors = false } = options;
  if (!billingPlansEl) return;

  setPricingLoadingState(true);
  billingPlansEl.innerHTML = "";

  try {
    const { response, data } = await fetchApiJson(
      `/api/pricing?version=${encodeURIComponent(billingSelectedVersion)}`,
      { method: "GET" }
    );

    if (!response.ok) {
      throw new Error(data?.error || "Не удалось загрузить тарифы.");
    }

    pricingPlans = Array.isArray(data?.plans) ? data.plans : [];

    if (!pricingPlans.length) {
      billingPlansEl.innerHTML =
        '<div class="billing-plan-meta">Тарифы временно недоступны.</div>';
      selectedPlanId = null;
      return;
    }

    selectedPlanId = pricingPlans[0].id;
    renderPricingPlans();
  } catch {
    pricingPlans = [];
    selectedPlanId = null;
    billingPlansEl.innerHTML =
      '<div class="billing-plan-meta">Не удалось загрузить тарифы.</div>';
    if (!silentPricingErrors) setBillingError("Ошибка загрузки тарифов.");
  } finally {
    setPricingLoadingState(false);
  }
}

function renderPricingPlans() {
  if (!billingPlansEl) return;
  billingPlansEl.innerHTML = "";

  pricingPlans.forEach((plan) => {
    const planId = plan?.id;
    const planName = escapeHtml(plan?.name || "Тариф");
    const generations = Number(plan?.generations || 0);
    const priceRub = Number(plan?.price_rub || 0);
    const perGeneration = generations > 0 ? priceRub / generations : 0;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "billing-plan";
    if (String(planId) === String(selectedPlanId))
      button.classList.add("is-active");

    button.innerHTML = `
      <div class="billing-plan-header">
        <span class="billing-plan-badge">${planName}</span>
      </div>
      <div class="billing-plan-generations">${generations} генераций</div>
      <div class="billing-plan-price-row">
        <span class="billing-plan-price">${priceRub} ₽</span>
      </div>
      <div class="billing-plan-meta">${formatPricePerGeneration(
        perGeneration
      )} ₽ / ген.</div>
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
        version: billingSelectedVersion,
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
      billingPayButton.textContent = "Оплатить";
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
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const url = `${apiBase()}/auth/google/start?redirect=${encodeURIComponent(
    redirect || "/"
  )}`;
  document.getElementById("google-auth-modal-link")?.setAttribute("href", url);
}

function renderTelegramAuthWidget() {
  const host = document.getElementById("telegram-auth-widget");
  if (!host) return;

  host.innerHTML = "";
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://telegram.org/js/telegram-widget.js?22";
  s.setAttribute("data-telegram-login", "nano_bananaa_ai_bot");
  s.setAttribute("data-size", "large");
  s.setAttribute(
    "data-auth-url",
    `${apiBase()}/auth/telegram/callback?redirect=${encodeURIComponent(
      redirect || "/"
    )}`
  );
  s.setAttribute("data-request-access", "write");
  host.appendChild(s);
}

function openAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;
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

function openResultModal(imageUrl) {
  const modal = document.getElementById("result-modal");
  const img = document.getElementById("result-modal-image");
  const dl = document.getElementById("result-modal-download");
  if (!modal || !img || !dl) return;

  img.src = imageUrl;
  dl.href = imageUrl;
  dl.download = `nano-banana-${Date.now()}.png`;

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

function bindResultModal() {
  const closeBtn = document.getElementById("result-modal-close");
  const backdrop = document.querySelector("[data-close-result-modal]");
  const animateBtn = document.getElementById("result-modal-animate");
  closeBtn?.addEventListener("click", closeResultModal);
  backdrop?.addEventListener("click", closeResultModal);
  animateBtn?.addEventListener("click", async (event) => {
    event.preventDefault();
    const VIDEO_REF_SESSION_KEY = "nano_video_ref_image";
    try {
      localStorage.setItem("nano_generator_mode", "video");
    } catch {
      /* ignore quota / private mode */
    }

    const modalImg = document.getElementById("result-modal-image");
    const src = modalImg?.currentSrc || modalImg?.getAttribute("src") || "";
    try {
      if (src.startsWith("data:")) {
        sessionStorage.setItem(VIDEO_REF_SESSION_KEY, src);
      } else if (src && /^https?:\/\//i.test(src)) {
        const res = await fetch(src);
        if (res.ok) {
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          });
          sessionStorage.setItem(VIDEO_REF_SESSION_KEY, dataUrl);
        }
      }
    } catch {
      /* квота sessionStorage / сеть — переходим без вложения */
    }

    window.location.assign("/generate.html");
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
  const rootMobile = document.getElementById("site-header-auth-mobile");
  const header = document.getElementById("site-header");

  renderHeaderAuthLoading(root);
  if (rootMobile) renderHeaderAuthLoading(rootMobile);
  captureSessionTokenFromUrl();
  try {
    const data = await fetchAuthMeCached({ maxAgeMs: 0 });
    if (data) {
      header?.classList.remove("is-hidden");
      renderHeaderAuthed(root, data);
      if (rootMobile) renderHeaderAuthed(rootMobile, data);
    } else {
      header?.classList.remove("is-hidden");
      renderHeaderGuest(root);
      if (rootMobile) renderHeaderGuest(rootMobile);
    }
  } catch {
    header?.classList.remove("is-hidden");
    renderHeaderAuthError(root);
    if (rootMobile) renderHeaderAuthError(rootMobile);
  }
}

function bindHeaderBurgerMenu() {
  const burger = document.getElementById("site-header-burger");
  const drawer = document.getElementById("site-header-drawer");
  const closeBtn = document.getElementById("site-header-drawer-close");

  if (!burger || !drawer || !closeBtn) return;

  const close = () => {
    burger.setAttribute("aria-expanded", "false");
    drawer.setAttribute("aria-hidden", "true");
    drawer.classList.remove("is-open");
  };

  const open = () => {
    burger.setAttribute("aria-expanded", "true");
    drawer.setAttribute("aria-hidden", "false");
    drawer.classList.add("is-open");
  };

  burger.addEventListener("click", () => {
    const expanded = burger.getAttribute("aria-expanded") === "true";
    if (expanded) close();
    else open();
  });

  closeBtn.addEventListener("click", close);
  document.addEventListener("click", (event) => {
    const expanded = burger.getAttribute("aria-expanded") === "true";
    if (!expanded) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (drawer.contains(target) || burger.contains(target)) return;
    close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
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

function bindHomeGenerator() {
  const promptEl = document.getElementById("prompt");
  const btn = document.getElementById("home-generate");
  const img = document.getElementById("home-result");
  const downloadLink = document.getElementById("home-result-download");
  const fileInput = document.getElementById("home-images");
  const attachBtn = document.getElementById("home-attach");
  if (!promptEl || !btn || !img || !fileInput || !attachBtn) return;

  const hideHomeDownload = () => {
    if (!downloadLink) return;
    downloadLink.classList.add("hidden");
    downloadLink.setAttribute("href", "#");
  };

  const setLoading = (on) => {
    btn.disabled = !!on;
    btn.textContent = on ? "Создаём..." : "Создать фото";
    setHomeProgressVisible(!!on);
  };

  const run = async () => {
    const prompt = String(promptEl.value || "").trim();
    if (!prompt) {
      promptEl.setCustomValidity("Введите текст промпта.");
      promptEl.reportValidity();
      return;
    }
    promptEl.setCustomValidity("");

    setLoading(true);
    img.classList.add("hidden");
    img.removeAttribute("src");
    hideHomeDownload();
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
          "warning"
        );
        return;
      }

      if (result?.status === 422 || result?.data?.code === "PROMPT_BLOCKED") {
        window.showToast(
          result?.data?.error || "Запрос не прошёл проверку.",
          "warning"
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

      if (downloadLink) {
        const mime = String(first.mimeType || "image/png").toLowerCase();
        const ext = mime.includes("jpeg") || mime.includes("jpg")
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

      openResultModal(dataUrl);
      void refreshSiteHeaderAuth();
    } catch (error) {
      const raw = String(error?.message || "");
      const netFail =
        /failed to fetch|load failed|network/i.test(raw.toLowerCase());
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

  attachBtn.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", (event) => {
    const incoming = Array.from(event.target.files || []);
    const merged = [...homeSelectedFiles, ...incoming].slice(
      0,
      HOME_MAX_IMAGES
    );
    const exceeded =
      homeSelectedFiles.length + incoming.length > HOME_MAX_IMAGES;
    homeSelectedFiles = merged;
    updateHomeFilesCount();
    renderHomePreviews();
    fileInput.value = "";

    if (exceeded) {
      /* ignore */
    }
  });

  updateHomeFilesCount();
  renderHomePreviews();

  btn.addEventListener("click", () => void run());
  promptEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.isComposing) return;
    if (event.shiftKey) return;
    event.preventDefault();
    void run();
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
  bindPricingTabs();
  setGoogleAuthLinks();
  bindAuthModal();
  bindResultModal();
  bindBillingModal();
  bindHeaderBurgerMenu();
  bindFaqAccordion();
  void refreshSiteHeaderAuth();
  bindHomeGenerator();
});
