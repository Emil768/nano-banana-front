// Страница /promt-po-foto/: картинка → промт (EN + RU) через POST /api/describe-image.
// Вход, сессия и адрес API — из index.js (fetchAuthMeCached, openAuthModal,
// getSessionToken, apiBase), он подключён раньше этого файла.
(function () {
  const root = document.getElementById("describe");
  if (!root) return;

  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_SIDE = 1024;
  const JPEG_QUALITY = 0.85;
  // Картинка переживает вход через Telegram/Google (там полная перезагрузка страницы)
  const PENDING_IMAGE_KEY = "nano_describe_image";

  const $ = (id) => document.getElementById(id);
  const drop = root.querySelector("[data-describe-drop]");
  const fileInput = $("describe-file");
  const preview = $("describe-preview");
  const previewImg = $("describe-img");
  const goBtn = $("describe-go");
  const loading = $("describe-loading");
  const errorBox = $("describe-error");
  const errorText = $("describe-error-text");
  const resultBox = $("describe-result");
  const resultText = $("describe-text");
  const tagsBox = $("describe-tags");
  const toast = $("toast");

  let imageDataUrl = "";
  let lang = "en";
  let result = null;
  let busy = false;
  let toastTimer = null;

  /* ---------- Мелочи ---------- */

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-on"), 1800);
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
  }

  function hideError() {
    errorBox.hidden = true;
  }

  function setBusy(on) {
    busy = on;
    goBtn.disabled = on;
    $("describe-again").disabled = on;
    loading.hidden = !on;
  }

  /* ---------- Картинка: сжатие до 1024 px, JPEG 0.85 ---------- */

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        // Прозрачные PNG — на белом, иначе в JPEG станут чёрными
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      img.src = url;
    });
  }

  function setImage(dataUrl) {
    imageDataUrl = dataUrl;
    previewImg.src = dataUrl;
    preview.hidden = false;
    drop.classList.add("has-file");
    result = null;
    resultBox.hidden = true;
    hideError();
  }

  function clearImage() {
    imageDataUrl = "";
    previewImg.removeAttribute("src");
    preview.hidden = true;
    drop.classList.remove("has-file");
    try {
      sessionStorage.removeItem(PENDING_IMAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function takeFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      showError("Подойдут картинки JPG, PNG или WEBP.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showError("Картинка больше 10 МБ — выберите поменьше.");
      return;
    }
    try {
      setImage(await compressImage(file));
    } catch {
      showError("Не получилось открыть картинку. Попробуйте другую.");
    }
  }

  root.querySelectorAll("[data-describe-pick]").forEach((btn) =>
    btn.addEventListener("click", () => fileInput.click())
  );
  fileInput.addEventListener("change", () => {
    void takeFile(fileInput.files?.[0]);
    fileInput.value = "";
  });
  $("describe-remove").addEventListener("click", clearImage);

  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    })
  );
  drop.addEventListener("dragleave", (event) => {
    if (!drop.contains(event.relatedTarget)) drop.classList.remove("is-over");
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    void takeFile(event.dataTransfer?.files?.[0]);
  });
  drop.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (!imageDataUrl) fileInput.click();
  });

  // Ctrl+V — картинка из буфера обмена
  document.addEventListener("paste", (event) => {
    if (busy) return;
    const item = Array.from(event.clipboardData?.items || []).find(
      (i) => i.kind === "file" && i.type.startsWith("image/")
    );
    const file = item?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void takeFile(file);
  });

  /* ---------- Язык ---------- */

  function renderResult() {
    if (!result) return;
    resultText.textContent = lang === "ru" ? result.prompt_ru : result.prompt_en;
    tagsBox.textContent = "";
    (result.tags_ru || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "chip dtag";
      chip.textContent = tag;
      tagsBox.appendChild(chip);
    });
    resultBox.hidden = false;
  }

  root.querySelectorAll("[data-lang]").forEach((btn) =>
    btn.addEventListener("click", () => {
      lang = btn.dataset.lang === "ru" ? "ru" : "en";
      root.querySelectorAll("[data-lang]").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", String(on));
      });
      renderResult();
    })
  );

  /* ---------- Запрос ---------- */

  async function authHeaders() {
    const headers = new Headers({ Accept: "application/json" });
    const token = getSessionToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  async function requestPrompt(variant) {
    if (busy) return;
    hideError();
    if (!imageDataUrl) {
      showError("Сначала загрузите картинку.");
      return;
    }

    const auth = await fetchAuthMeCached({ maxAgeMs: 15000 });
    if (!auth) {
      // Вход — с перезагрузкой страницы; картинку сохраняем, чтобы не потерять
      try {
        sessionStorage.setItem(PENDING_IMAGE_KEY, imageDataUrl);
      } catch {
        /* не влезла — придётся загрузить заново */
      }
      openAuthModal();
      return;
    }

    setBusy(true);
    try {
      const headers = await authHeaders();
      headers.set("Content-Type", "application/json");
      const response = await fetch(`${apiBase()}/api/describe-image`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ image: imageDataUrl, variant: Boolean(variant) }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        openAuthModal();
        return;
      }
      if (response.status === 429) {
        showError("Слишком много запросов подряд. Подождите минуту и попробуйте снова.");
        return;
      }
      if (response.status === 422) {
        showError("Эту картинку не получится описать. Попробуйте другую.");
        return;
      }
      if (response.status === 413) {
        showError("Картинка слишком большая. Попробуйте другую.");
        return;
      }
      if (!response.ok || !data.prompt_en) {
        showError("Не получилось, попробуйте ещё раз.");
        return;
      }

      result = data;
      renderResult();
      try {
        sessionStorage.removeItem(PENDING_IMAGE_KEY);
      } catch {
        /* ignore */
      }
    } catch {
      showError("Не получилось, попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  goBtn.addEventListener("click", () => void requestPrompt(false));
  $("describe-again").addEventListener("click", () => void requestPrompt(true));

  $("describe-copy").addEventListener("click", async () => {
    if (!result) return;
    const text = lang === "ru" ? result.prompt_ru : result.prompt_en;
    const ok = await copyTextToClipboard(text);
    showToast(ok ? "Промт скопирован" : "Не удалось скопировать");
  });

  // «Сгенерировать похожее» — EN-промт в генератор на главной
  $("describe-use").addEventListener("click", () => {
    if (!result) return;
    const params = new URLSearchParams({ prompt: result.prompt_en });
    window.location.href = `/?${params.toString()}`;
  });

  /* ---------- Старт ---------- */

  // Вернулись после входа — картинка на месте
  try {
    const pending = sessionStorage.getItem(PENDING_IMAGE_KEY);
    if (pending) setImage(pending);
  } catch {
    /* ignore */
  }

})();
