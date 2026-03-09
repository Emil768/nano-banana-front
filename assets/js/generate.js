const MAX_IMAGES = 4;
const MAX_BASE64_SIZE = 18 * 1024 * 1024;
const TOAST_DURATION_MS = 3600;
const PRO_PRICE_PER_GEN = 8;
const FREE_PRICE_PER_GEN = 5;
const SESSION_TOKEN_STORAGE_KEY = "nano_session_token";
const SSE_RECONNECT_DELAY_MS = 3000;
const FALLBACK_API_BASE_URL =
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost"
    ? "http://127.0.0.1:3000"
    : "https://nanobananaa.up.railway.app";
const API_BASE_URL = (
  window.NANO_API_BASE_URL || FALLBACK_API_BASE_URL
).replace(/\/$/, "");

const form = document.getElementById("generator-form");
const promptInput = document.getElementById("prompt");
const fileInput = document.getElementById("reference-images");
const previewGrid = document.getElementById("preview-grid");
const uploadTile = document.getElementById("upload-tile");
const resultSection = document.getElementById("result-section");
const resultImage = document.getElementById("result-image");
const resultGallery = document.getElementById("result-gallery");
const downloadLink = document.getElementById("download-link");
const resetButton = document.getElementById("reset-button");
const resultPlaceholder = document.getElementById("result-placeholder");
const referenceCount = document.getElementById("reference-count");
const resolutionButtons = document.querySelectorAll(".resolution-button");
const ratioButtons = document.querySelectorAll(".ratio-button");
const authModal = document.getElementById("auth-modal");
const authModalCloseButton = document.getElementById("auth-modal-close");
const authModalBackdrop = document.querySelector("[data-close-auth-modal]");
const billingModal = document.getElementById("billing-modal");
const billingModalCloseButton = document.getElementById("billing-modal-close");
const billingModalBackdrop = document.querySelector(
  "[data-close-billing-modal]"
);
const billingPlansEl = document.getElementById("billing-plans");
const billingPayButton = document.getElementById("billing-pay-button");
const billingLoadingEl = document.getElementById("billing-loading");
const resultLoading = document.getElementById("result-loading");
const accountHeader = document.getElementById("account-header");
const generatorCard = document.querySelector(".generator-card");
const accountAvatar = document.getElementById("account-avatar");
const accountAvatarFallback = document.getElementById(
  "account-avatar-fallback"
);
const accountId = document.getElementById("account-id");
const accountBalance = document.getElementById("account-balance");
const accountBalancePending = document.getElementById(
  "account-balance-pending"
);
const accountBalancePendingText = document.getElementById(
  "account-balance-pending-text"
);
const topupButton = document.getElementById("topup-button");
const versionTabPro = document.getElementById("version-tab-pro");
const versionTabFree = document.getElementById("version-tab-free");
const freeDiscountBadge = document.getElementById("free-discount-badge");
const resolutionGroup = document.getElementById("resolution-group");
const imagesAmountEl = document.getElementById("images-amount");
const decreaseImagesBtn = document.getElementById("decrease-images");
const increaseImagesBtn = document.getElementById("increase-images");
const generateButton = document.getElementById("generate-button");

let selectedResolution = "4K";
let selectedRatio = "auto";
let selectedVersion = "pro";
let selectedFiles = [];
let currentAuthState = null;
let toastContainer = null;
let pricingPlans = [];
let selectedPlanId = null;
let imagesAmount = 1;
let generatedResults = [];
let sessionToken = getStoredSessionToken();
let balanceEventsSource = null;
let balanceEventsReconnectTimer = null;
let authStateResolved = false;
let isAuthResolving = false;
let isPricingLoading = false;

bootstrapState();
bindEvents();
renderPreviews();

function bindEvents() {
  resolutionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      resolutionButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      selectedResolution = button.dataset.size;
    });
  });

  ratioButtons.forEach((button) => {
    button.addEventListener("click", () => {
      ratioButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      selectedRatio = button.dataset.ratio;
    });
  });

  fileInput.addEventListener("change", (event) => {
    const incomingFiles = Array.from(event.target.files || []);
    const beforeMergeCount = selectedFiles.length + incomingFiles.length;
    selectedFiles = [...selectedFiles, ...incomingFiles].slice(0, MAX_IMAGES);
    renderPreviews();
    if (beforeMergeCount > MAX_IMAGES) {
      showToast(
        `Можно добавить максимум ${MAX_IMAGES} изображений.`,
        "warning"
      );
    }
    fileInput.value = "";
  });

  form.addEventListener("submit", handleSubmit);
  if (resetButton) {
    resetButton.addEventListener("click", handleResetGenerator);
  }
  if (authModalCloseButton) {
    authModalCloseButton.addEventListener("click", closeAuthModal);
  }
  if (authModalBackdrop) {
    authModalBackdrop.addEventListener("click", closeAuthModal);
  }
  if (billingModalCloseButton) {
    billingModalCloseButton.addEventListener("click", closeBillingModal);
  }
  if (billingModalBackdrop) {
    billingModalBackdrop.addEventListener("click", closeBillingModal);
  }
  if (billingPayButton) {
    billingPayButton.addEventListener("click", handlePayClick);
  }
  if (topupButton) {
    topupButton.addEventListener("click", async () => {
      await openBillingModal();
    });
  }
  if (versionTabPro) {
    versionTabPro.addEventListener("click", () => handleVersionChange("pro"));
  }
  if (versionTabFree) {
    versionTabFree.addEventListener("click", () => handleVersionChange("free"));
  }
  if (decreaseImagesBtn) {
    decreaseImagesBtn.addEventListener("click", () => {
      imagesAmount = Math.max(1, imagesAmount - 1);
      updateImagesAmountUI();
    });
  }
  if (increaseImagesBtn) {
    increaseImagesBtn.addEventListener("click", () => {
      const maxByBalance = getMaxGenerationsByBalance();
      imagesAmount = Math.min(maxByBalance, imagesAmount + 1);
      updateImagesAmountUI();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAuthModal();
      closeBillingModal();
    }
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!authStateResolved || isAuthResolving) {
    showToast("Проверяем аккаунт, пожалуйста подожди.", "info");
    return;
  }

  if (!currentAuthState) {
    openAuthModal();
    showToast(
      "Сначала войди через Telegram, затем повтори генерацию.",
      "warning"
    );
    return;
  }
  renderAccount(currentAuthState);

  const currentBalance = getCurrentBalanceByVersion(
    currentAuthState,
    selectedVersion
  );
  if (Number.isFinite(currentBalance) && currentBalance <= 0) {
    await openBillingModal({ silentPricingErrors: true });
    showToast(
      "Недостаточно генераций. Пополни баланс, чтобы продолжить.",
      "warning"
    );
    return;
  }
  if (Number.isFinite(currentBalance) && imagesAmount > currentBalance) {
    imagesAmount = Math.max(
      1,
      Math.min(getMaxGenerationsByBalance(), imagesAmount)
    );
    updateImagesAmountUI();
    await openBillingModal({ silentPricingErrors: true });
    showToast(
      "Недостаточно баланса для выбранного количества генераций.",
      "warning"
    );
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) {
    showToast("Введите текст промпта.", "warning");
    return;
  }

  try {
    setLoadingState(true);
    showLoadingResult();
    hideResult();

    const imagesPayload = await Promise.all(
      selectedFiles.map(async (file) => {
        const { data, mimeType } = await fileToBase64(file);
        return { data, mimeType };
      })
    );

    const payload = {
      version: selectedVersion,
      contents: [
        {
          parts: [
            { text: prompt },
            ...imagesPayload.map((image) => ({
              inline_data: {
                mime_type: image.mimeType,
                data: image.data,
              },
            })),
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          ...(selectedVersion === "pro"
            ? {
                imageSize: selectedResolution,
                aspectRatio: selectedRatio === "auto" ? "" : selectedRatio,
              }
            : {
                aspectRatio: selectedRatio === "auto" ? "" : selectedRatio,
              }),
        },
      },
      numberOfImages: imagesAmount,
    };

    const { response, data: result } = await fetchApiJson(
      "/api/generate-image",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      if (response.status === 402 || result?.code === "INSUFFICIENT_BALANCE") {
        await openBillingModal({ silentPricingErrors: true });
        throw new Error("INSUFFICIENT_BALANCE");
      }
      throw new Error(result?.error || "GENERATION_FAILED");
    }

    const imagePayloads = extractImagePayloads(result);
    if (!imagePayloads.length) {
      throw new Error("Сервер не вернул изображение.");
    }

    generatedResults = imagePayloads.map((item, index) => ({
      id: `${Date.now()}-${index + 1}`,
      url: `data:${item.mimeType};base64,${item.data}`,
    }));
    renderResultGallery(generatedResults);
    configureDownloadLink(generatedResults);
    showResult();
    if (typeof result?.balance === "number" && accountBalance) {
      if (currentAuthState) {
        if (selectedVersion === "free") {
          currentAuthState.balance_free = result.balance;
        } else {
          currentAuthState.balance = result.balance;
        }
      }
      updateAccountBalanceDisplay(currentAuthState);
      imagesAmount = Math.min(imagesAmount, getMaxGenerationsByBalance());
      updateImagesAmountUI();
    }
    if (result?.partial) {
      showToast(
        `Сгенерировано ${generatedResults.length} из ${
          result?.requested || imagesAmount
        }. Ошибок: ${result?.failed || 0}.`,
        "warning"
      );
    }
    showToast("Успешная генерация", "success");
  } catch (error) {
    const message = resolveGenerationErrorMessage(error);
    const isInsufficient = message.includes("Недостаточно генераций");
    showToast(message, isInsufficient ? "warning" : "error");
  } finally {
    hideLoadingResult();
    setLoadingState(false);
  }
}

function renderPreviews() {
  previewGrid.innerHTML = "";
  referenceCount.textContent = `${selectedFiles.length}/${MAX_IMAGES}`;
  updateUploadTileVisibility();

  selectedFiles.forEach((file, index) => {
    const card = document.createElement("div");
    card.className = "preview-card";

    const img = document.createElement("img");
    img.className = "preview-image";
    img.alt = `Референс ${index + 1}`;
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "preview-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Удалить референс ${index + 1}`);
    removeButton.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderPreviews();
    });

    card.append(img, removeButton);
    previewGrid.append(card);
  });
}

function setLoadingState(isLoading) {
  if (!generateButton) return;
  generateButton.disabled = isLoading;
  generateButton.textContent = isLoading ? "Генерация..." : "Сгенерировать";
  if (!isLoading) {
    updateGenerateButtonAvailability();
  }
}

function bootstrapState() {
  captureSessionTokenFromUrl();
  updateDiscountBadge();
  updateImagesAmountUI();
  applyVersionUI();
  void refreshAuthState({ showLoading: true, initial: true });
  handlePaymentReturnState();
}

function hideResult() {
  resultSection.classList.remove("hidden");
  resultPlaceholder.classList.remove("hidden");
  resultImage.classList.add("hidden");
  if (resultGallery) {
    resultGallery.classList.add("hidden");
    resultGallery.classList.remove("result-gallery--single");
    resultGallery.innerHTML = "";
  }
  downloadLink.classList.add("hidden");
  if (resetButton) {
    resetButton.classList.add("hidden");
  }
  generatedResults = [];
  resultImage.src = "";
  downloadLink.removeAttribute("href");
}

function showResult() {
  resultSection.classList.remove("hidden");
  resultPlaceholder.classList.add("hidden");
  resultImage.classList.add("hidden");
  if (resultGallery && generatedResults.length) {
    resultGallery.classList.remove("hidden");
  }
  downloadLink.classList.add("hidden");
  if (resetButton) {
    resetButton.classList.remove("hidden");
  }
}

function updateUploadTileVisibility() {
  if (!uploadTile) return;
  uploadTile.classList.toggle("hidden", selectedFiles.length >= MAX_IMAGES);
}

function openAuthModal() {
  if (!authModal) return;
  authModal.classList.remove("hidden");
  authModal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.classList.add("hidden");
  authModal.setAttribute("aria-hidden", "true");
}

async function openBillingModal(options = {}) {
  if (!billingModal) return;
  billingModal.classList.remove("hidden");
  billingModal.setAttribute("aria-hidden", "false");
  await loadPricingPlans(options);
}

function closeBillingModal() {
  if (!billingModal) return;
  billingModal.classList.add("hidden");
  billingModal.setAttribute("aria-hidden", "true");
}

async function fetchApiJson(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  const response = await fetch(buildApiUrl(path), {
    credentials: "include",
    ...init,
    headers,
  });
  const data = await parseJsonSafely(response);
  return { response, data };
}

function buildApiUrl(path) {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path}`;
}

async function loadPricingPlans(options = {}) {
  const { silentPricingErrors = false } = options;
  if (!billingPlansEl) return;
  setPricingLoadingState(true);
  billingPlansEl.innerHTML = "";

  try {
    const { response, data } = await fetchApiJson(
      `/api/pricing?version=${encodeURIComponent(selectedVersion)}`,
      { method: "GET" }
    );
    if (!response.ok) {
      throw new Error(data?.error || "Не удалось загрузить тарифы.");
    }

    pricingPlans = Array.isArray(data?.plans) ? data.plans : [];
    if (!pricingPlans.length) {
      billingPlansEl.innerHTML =
        '<div class="billing-plan__meta">Тарифы временно недоступны.</div>';
      selectedPlanId = null;
      return;
    }

    selectedPlanId = pricingPlans[0].id;
    renderPricingPlans();
  } catch (error) {
    pricingPlans = [];
    selectedPlanId = null;
    billingPlansEl.innerHTML =
      '<div class="billing-plan__meta">Ошибка загрузки тарифов.</div>';
    if (!silentPricingErrors) {
      showToast("Ошибка загрузки тарифов.", "error");
    }
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
    if (String(planId) === String(selectedPlanId)) {
      button.classList.add("is-active");
    }
    button.innerHTML = `
      <div class="billing-plan__header">
        <span class="billing-plan__badge">${planName}</span>
      </div>
      <div class="billing-plan__generations">${generations} генераций</div>
      <div class="billing-plan__price-row">
        <span class="billing-plan__price">${priceRub} ₽</span>
      </div>
      <div class="billing-plan__meta">${formatPricePerGeneration(
        perGeneration
      )} ₽ / генерация</div>
    `;
    button.addEventListener("click", () => {
      selectedPlanId = planId;
      renderPricingPlans();
      if (billingPayButton && !isPricingLoading) {
        billingPayButton.disabled = !selectedPlanId;
      }
    });
    billingPlansEl.appendChild(button);
  });
}

async function handlePayClick() {
  if (isPricingLoading) return;
  if (!selectedPlanId) {
    showToast("Сначала выбери тариф.", "warning");
    return;
  }

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
        version: selectedVersion,
      }),
    });
    if (!response.ok) {
      throw new Error(data?.error || "Не удалось создать платеж.");
    }
    if (!data?.paymentUrl) {
      throw new Error("Платежная ссылка не получена.");
    }
    window.location.href = data.paymentUrl;
  } catch (error) {
    showToast(error?.message || "Ошибка создания платежа.", "error");
  } finally {
    if (billingPayButton) {
      billingPayButton.disabled = false;
      billingPayButton.textContent = "Оплатить";
    }
  }
}

async function fetchAuthMe() {
  try {
    const { response, data } = await fetchApiJson("/auth/me", {
      method: "GET",
    });
    if (!response.ok) return null;
    return data;
  } catch {
    return null;
  }
}

function handleResetGenerator() {
  promptInput.value = "";
  selectedFiles = [];
  imagesAmount = 1;
  renderPreviews();
  updateImagesAmountUI();
  hideLoadingResult();
  hideResult();
}

function showLoadingResult() {
  if (!resultLoading) return;
  resultLoading.classList.remove("hidden");
}

function hideLoadingResult() {
  if (!resultLoading) return;
  resultLoading.classList.add("hidden");
}

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, type = "info") {
  if (!message) return;
  const host = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;

  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  const removeToast = () => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  };

  window.setTimeout(removeToast, TOAST_DURATION_MS);
  toast.addEventListener("click", removeToast, { once: true });

  while (host.childElementCount > 4) {
    host.removeChild(host.firstElementChild);
  }
}

async function refreshAuthState(options = {}) {
  const { showLoading = false, initial = false } = options;
  if (showLoading) {
    setAuthResolvingState(true);
  }
  const authState = await fetchAuthMe();
  if (authState) {
    currentAuthState = authState;
    selectedVersion = normalizeVersion(
      authState?.version || authState?.user?.version
    );
    renderAccount(authState);
    setBalancePendingState(false);
    applyVersionUI();
    updateImagesAmountUI();
    closeAuthModal();
    startBalanceEvents();
  } else {
    stopBalanceEvents();
    resetAccount();
  }
  if (initial) {
    authStateResolved = true;
  }
  if (showLoading) {
    setAuthResolvingState(false);
  }
  updateGenerateButtonAvailability();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveGenerationErrorMessage(error) {
  const raw = String(error?.message || "");
  if (raw === "INSUFFICIENT_BALANCE") {
    return "Недостаточно генераций. Выбери тариф и пополни баланс.";
  }
  if (raw.includes("Ошибка генерации, попробуйте еще раз через 10 секунд")) {
    return "Ошибка генерации, попробуйте еще раз через 10 секунд";
  }
  return "Ошибка генерации";
}

function formatPricePerGeneration(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value >= 10 ? Math.round(value).toString() : value.toFixed(1);
}

async function parseJsonSafely(response) {
  if (!response) return {};
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function handlePaymentReturnState() {
  const url = new URL(window.location.href);
  const paymentState = url.searchParams.get("payment");
  if (!paymentState) return;

  if (paymentState === "success") {
    setBalancePendingState(true, "оплата обрабатывается");
    showToast("Оплата принята. Ожидаем подтверждение платежа...", "info");
    void refreshAuthState();
  } else if (paymentState === "cancel") {
    setBalancePendingState(false);
    showToast("Оплата не завершена.", "warning");
  }

  url.searchParams.delete("payment");
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

function normalizeVersion(value) {
  return String(value || "").toLowerCase() === "free" ? "free" : "pro";
}

function getStoredSessionToken() {
  try {
    return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function captureSessionTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = String(url.searchParams.get("session") || "").trim();
  if (!token) return;
  sessionToken = token;
  try {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage errors and keep in-memory token.
  }
  url.searchParams.delete("session");
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
  if (balanceEventsSource) {
    stopBalanceEvents();
    if (currentAuthState) {
      startBalanceEvents();
    }
  }
}

function buildEventsUrl() {
  const baseUrl = buildApiUrl("/api/events");
  try {
    const url = new URL(baseUrl);
    if (sessionToken) {
      url.searchParams.set("session", sessionToken);
    }
    return url.toString();
  } catch {
    const params = new URLSearchParams();
    if (sessionToken) {
      params.set("session", sessionToken);
    }
    return params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
  }
}

function startBalanceEvents() {
  if (!window.EventSource || balanceEventsSource || !currentAuthState) return;
  const eventsUrl = buildEventsUrl();
  balanceEventsSource = new EventSource(eventsUrl, { withCredentials: true });
  balanceEventsSource.addEventListener("balance_update", () => {
    setBalancePendingState(false);
    showToast("Успешная оплата. Баланс обновлен.", "success");
    void refreshAuthState();
  });
  balanceEventsSource.addEventListener("payment_pending", () => {
    setBalancePendingState(true, "оплата обрабатывается");
    showToast("Оплата обрабатывается...", "info");
  });
  balanceEventsSource.addEventListener("payment_failed", () => {
    setBalancePendingState(false);
    showToast("❌ Ошибка оплаты", "error");
  });
  balanceEventsSource.onerror = () => {
    stopBalanceEvents();
    if (!currentAuthState) return;
    balanceEventsReconnectTimer = window.setTimeout(() => {
      startBalanceEvents();
    }, SSE_RECONNECT_DELAY_MS);
  };
}

function stopBalanceEvents() {
  if (balanceEventsReconnectTimer) {
    window.clearTimeout(balanceEventsReconnectTimer);
    balanceEventsReconnectTimer = null;
  }
  if (!balanceEventsSource) return;
  balanceEventsSource.close();
  balanceEventsSource = null;
}

function setBalancePendingState(visible, message = "оплата обрабатывается") {
  if (!accountBalancePending) return;
  accountBalancePending.classList.toggle("hidden", !visible);
  if (accountBalancePendingText) {
    accountBalancePendingText.textContent = message;
  }
}

function setPricingLoadingState(isLoading) {
  isPricingLoading = isLoading;
  if (billingLoadingEl) {
    billingLoadingEl.classList.toggle("hidden", !isLoading);
  }
  if (billingPayButton) {
    billingPayButton.disabled = isLoading || !selectedPlanId;
  }
}

function setAuthResolvingState(isLoading) {
  isAuthResolving = isLoading;
  if (isLoading) {
    if (accountHeader) {
      accountHeader.classList.remove("hidden");
    }
    if (accountId) {
      accountId.textContent = "Проверяем...";
    }
    if (accountBalance) {
      accountBalance.textContent = "—";
    }
    setBalancePendingState(true, "загрузка аккаунта...");
  } else if (!currentAuthState) {
    setBalancePendingState(false);
  }
  updateGenerateButtonAvailability();
}

function updateGenerateButtonAvailability() {
  if (!generateButton) return;
  if (!authStateResolved || isAuthResolving) {
    generateButton.disabled = true;
    generateButton.textContent = "Проверяем аккаунт...";
    return;
  }
  if (generateButton.textContent === "Проверяем аккаунт...") {
    generateButton.textContent = "Сгенерировать";
  }
  if (
    !generateButton.textContent ||
    generateButton.textContent === "Генерация..."
  ) {
    return;
  }
  generateButton.disabled = false;
}

function updateDiscountBadge() {
  if (!freeDiscountBadge) return;
  const discount = Math.max(
    0,
    Math.round((1 - FREE_PRICE_PER_GEN / Math.max(PRO_PRICE_PER_GEN, 1)) * 100)
  );
  freeDiscountBadge.textContent = `до ${discount}% дешевле`;
}

function applyVersionUI() {
  const isFree = selectedVersion === "free";
  if (versionTabPro) {
    versionTabPro.classList.toggle("is-active", !isFree);
  }
  if (versionTabFree) {
    versionTabFree.classList.toggle("is-active", isFree);
  }
  if (generatorCard) {
    generatorCard.classList.toggle("mode-free", isFree);
    generatorCard.classList.toggle("mode-pro", !isFree);
  }
  if (resolutionGroup) {
    resolutionGroup.classList.toggle("hidden", isFree);
  }
  updateAccountBalanceDisplay(currentAuthState);
  imagesAmount = Math.min(imagesAmount, getMaxGenerationsByBalance());
  updateImagesAmountUI();
}

async function handleVersionChange(nextVersionRaw) {
  const nextVersion = normalizeVersion(nextVersionRaw);
  if (nextVersion === selectedVersion) return;
  if (!authStateResolved || isAuthResolving) {
    showToast("Проверяем аккаунт, пожалуйста подожди.", "info");
    return;
  }
  if (!currentAuthState) {
    openAuthModal();
    showToast("Сначала войди через Telegram, затем выбери версию.", "warning");
    return;
  }

  const prevVersion = selectedVersion;
  selectedVersion = nextVersion;
  applyVersionUI();

  try {
    await persistVersion(nextVersion);
    if (currentAuthState?.user) {
      currentAuthState.user.version = nextVersion;
    }
    currentAuthState.version = nextVersion;
    showToast(
      nextVersion === "free"
        ? "Включена Free-версия: упрощенный режим."
        : "Включена Pro-версия.",
      "success"
    );
  } catch (error) {
    selectedVersion = prevVersion;
    applyVersionUI();
    showToast(error?.message || "Не удалось переключить версию.", "error");
  }
}

async function persistVersion(version) {
  const { response, data } = await fetchApiJson("/api/version", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  if (!response.ok) {
    throw new Error(data?.error || "Не удалось сохранить версию.");
  }
  return data;
}

function getMaxGenerationsByBalance() {
  const balance = getCurrentBalanceByVersion(currentAuthState, selectedVersion);
  if (!Number.isFinite(balance) || balance <= 0) return 1;
  return Math.max(1, Math.min(4, Math.floor(balance)));
}

function updateImagesAmountUI() {
  if (imagesAmountEl) {
    imagesAmountEl.textContent = `${imagesAmount}`;
  }
  const maxByBalance = getMaxGenerationsByBalance();
  if (decreaseImagesBtn) {
    decreaseImagesBtn.disabled = imagesAmount <= 1;
  }
  if (increaseImagesBtn) {
    increaseImagesBtn.disabled = imagesAmount >= maxByBalance;
  }
}

function renderResultGallery(items) {
  if (!resultGallery) return;
  resultGallery.innerHTML = "";
  resultGallery.classList.toggle("result-gallery--single", items.length === 1);

  items.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "result-gallery__item";

    const img = document.createElement("img");
    img.src = item.url;
    img.alt = `Результат ${idx + 1}`;
    img.className = "result-gallery__image";

    const dl = document.createElement("a");
    dl.href = item.url;
    dl.download = `nano-banana-${Date.now()}-${idx + 1}.png`;
    dl.className = "result-gallery__download";
    dl.textContent = "Скачать";

    card.append(img, dl);
    resultGallery.append(card);
  });
}

function configureDownloadLink(items) {
  if (!downloadLink) return;
  downloadLink.classList.add("hidden");
  downloadLink.removeAttribute("href");
  if (items.length) {
    downloadLink.href = items[0].url;
    downloadLink.download = `nano-banana-${Date.now()}-1.png`;
  }
}

function renderAccount(authState) {
  if (!accountHeader || !accountId || !accountBalance) return;
  accountHeader.classList.remove("hidden");
  if (topupButton) {
    topupButton.classList.remove("hidden");
  }
  const idText = authState?.chat_id
    ? `ID ${authState.chat_id}`
    : "Пользователь";
  accountId.textContent = idText;
  updateAccountBalanceDisplay(authState);
  imagesAmount = Math.min(imagesAmount, getMaxGenerationsByBalance());
  updateImagesAmountUI();

  const avatarUrl =
    authState?.user?.photo_url || authState?.user?.avatar_url || "";
  if (accountAvatar && accountAvatarFallback) {
    if (avatarUrl) {
      accountAvatar.src = avatarUrl;
      accountAvatar.classList.remove("hidden");
      accountAvatarFallback.classList.add("hidden");
    } else {
      accountAvatar.removeAttribute("src");
      accountAvatar.classList.add("hidden");
      accountAvatarFallback.classList.remove("hidden");
    }
  }
}

function getCurrentBalanceByVersion(authState, version) {
  if (!authState) return 0;
  const raw = version === "free" ? authState?.balance_free : authState?.balance;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return parsed;
  return 0;
}

function updateAccountBalanceDisplay(authState = currentAuthState) {
  if (!accountBalance) return;
  const balance = getCurrentBalanceByVersion(authState, selectedVersion);
  accountBalance.textContent = Number.isFinite(balance) ? `${balance}` : "—";
}

function resetAccount() {
  stopBalanceEvents();
  currentAuthState = null;
  selectedVersion = "pro";
  if (!accountHeader || !accountId || !accountBalance) return;
  accountHeader.classList.add("hidden");
  accountId.textContent = "Гость";
  accountBalance.textContent = "—";
  if (accountAvatar) {
    accountAvatar.removeAttribute("src");
    accountAvatar.classList.add("hidden");
  }
  if (accountAvatarFallback) {
    accountAvatarFallback.classList.remove("hidden");
  }
  if (topupButton) {
    topupButton.classList.add("hidden");
  }
  applyVersionUI();
  updateImagesAmountUI();
}

function extractImagePayloads(responseData) {
  if (!responseData || typeof responseData !== "object") return [];
  const list = [];
  const firstImagesItem = Array.isArray(responseData.images)
    ? responseData.images[0]
    : null;
  const fallbackMimeFromImages =
    firstImagesItem && typeof firstImagesItem === "object"
      ? firstImagesItem?.mimeType || firstImagesItem?.mime_type || "image/png"
      : "image/png";
  const push = (data, mimeType = "image/png") => {
    if (typeof data !== "string" || !data) return;
    list.push({ data, mimeType: mimeType || "image/png" });
  };

  if (typeof responseData.imageData === "string") {
    push(responseData.imageData, fallbackMimeFromImages);
  }

  if (Array.isArray(responseData.images)) {
    responseData.images.forEach((item) => {
      if (typeof item === "string") {
        push(item, "image/png");
      } else {
        push(item?.data, item?.mimeType || item?.mime_type || "image/png");
      }
    });
  }

  const candidateSets = [
    ...(Array.isArray(responseData?.candidates) ? responseData.candidates : []),
    ...(Array.isArray(responseData?.data?.candidates)
      ? responseData.data.candidates
      : []),
  ];
  candidateSets.forEach((candidate) => {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];
    parts.forEach((part) => {
      const inline = part?.inline_data || part?.inlineData;
      push(inline?.data, inline?.mime_type || inline?.mimeType || "image/png");
    });
  });

  const seen = new Set();
  return list.filter((item) => {
    const key = item.data;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    convertFileToJpegDataUrl(file)
      .then((dataUrl) => {
        const base64 = dataUrl.split(",")[1] || "";
        if (base64.length > MAX_BASE64_SIZE) {
          reject(
            new Error(
              "Один из файлов слишком большой. Уменьши размер изображения."
            )
          );
          return;
        }
        resolve({ mimeType: "image/jpeg", data: base64 });
      })
      .catch(() => reject(new Error("Ошибка чтения файла.")));
  });
}

function convertFileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Не удалось прочитать файл."));
        return;
      }

      const originalDataUrl = reader.result;
      // Keep native jpeg as-is to avoid unnecessary recompression.
      if ((file.type || "").toLowerCase() === "image/jpeg") {
        resolve(originalDataUrl);
        return;
      }

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Не удалось создать canvas."));
          return;
        }

        // White background removes alpha channel safely for jpeg.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      image.onerror = () =>
        reject(new Error("Не удалось обработать изображение."));
      image.src = originalDataUrl;
    };
    reader.onerror = () => reject(new Error("Ошибка чтения файла."));
    reader.readAsDataURL(file);
  });
}
