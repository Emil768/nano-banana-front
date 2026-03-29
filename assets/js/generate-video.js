(function () {
  const MODE_IMAGE = "image";
  const MODE_VIDEO = "video";
  const POLL_MS = 60_000;
  /** ~2 ч макс. ожидания, дальше — остановка с сообщением */
  const MAX_POLL_TICKS = 120;
  const GENERATOR_MODE_STORAGE_KEY = "nano_generator_mode";

  let mode = MODE_IMAGE;
  let videoFile = null;
  let videoSound = false;
  let videoDuration = "5";
  let pollTimer = null;

  const tabImage = document.getElementById("mode-tab-image");
  const tabVideo = document.getElementById("mode-tab-video");
  const panelImage = document.getElementById("generator-panel-image");
  const panelVideo = document.getElementById("generator-panel-video");
  const form = document.getElementById("generator-form");
  const promptInput = document.getElementById("prompt");
  const promptsButton = document.getElementById("prompts-button");
  const videoFileInput = document.getElementById("video-reference-image");
  const videoPreviewGrid = document.getElementById("video-preview-grid");
  const videoUploadTile = document.getElementById("video-upload-tile");
  const generateButton = document.getElementById("generate-button");
  const resultLoadingTitle = document.getElementById("result-loading-title");
  const resultPlaceholder = document.getElementById("result-placeholder");
  const resultVideo = document.getElementById("result-video");
  const downloadLink = document.getElementById("download-link");
  const resetButton = document.getElementById("reset-button");

  const soundOffBtn = document.getElementById("video-sound-off");
  const soundOnBtn = document.getElementById("video-sound-on");
  const duration5Btn = document.getElementById("video-duration-5");
  const duration10Btn = document.getElementById("video-duration-10");

  function getVideoCost(sound, durationRaw) {
    const d = String(durationRaw) === "10" ? "10" : "5";
    const s = Boolean(sound);
    if (d === "5" && !s) return 5;
    if (d === "10" && !s) return 10;
    if (d === "5" && s) return 10;
    if (d === "10" && s) return 20;
    return 5;
  }

  function ctx() {
    return window.__nanoGenerateContext;
  }

  function showToast(message, type, duration) {
    window.__nanoShowToast?.(message, type, duration);
  }

  function fetchApiJson(path, init) {
    return window.__nanoFetchApiJson(path, init);
  }

  function refreshVideoButtonLabel() {
    if (!generateButton) return;
    // Не трогаем кнопку только во время активной генерации (не «Проверка…» —
    // иначе после auth кнопка навсегда остаётся «Проверка...»).
    if (generateButton.textContent === "Генерация...") {
      return;
    }
    const cost = getVideoCost(videoSound, videoDuration);
    generateButton.textContent = `Сгенерировать (${cost} ⚡)`;
  }

  function setPlaceholderText() {
    if (!resultPlaceholder) return;
    resultPlaceholder.textContent =
      mode === MODE_VIDEO
        ? "Здесь появится сгенерированное видео"
        : "Здесь появится сгенерированное изображение";
  }

  function updatePromptsButtonVisibility() {
    if (!promptsButton) return;
    promptsButton.classList.toggle("hidden", mode === MODE_VIDEO);
  }

  function persistMode(next) {
    try {
      localStorage.setItem(GENERATOR_MODE_STORAGE_KEY, next);
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function switchMode(next) {
    if (next !== MODE_IMAGE && next !== MODE_VIDEO) return;
    mode = next;
    persistMode(next);

    tabImage?.classList.toggle("is-active", mode === MODE_IMAGE);
    tabVideo?.classList.toggle("is-active", mode === MODE_VIDEO);
    tabImage?.setAttribute(
      "aria-selected",
      mode === MODE_IMAGE ? "true" : "false"
    );
    tabVideo?.setAttribute(
      "aria-selected",
      mode === MODE_VIDEO ? "true" : "false"
    );

    panelImage?.classList.toggle("hidden", mode !== MODE_IMAGE);
    panelVideo?.classList.toggle("hidden", mode !== MODE_VIDEO);

    setPlaceholderText();
    updatePromptsButtonVisibility();
    window.__nanoUpdateGenerateButtonAvailability?.();
  }

  function renderVideoPreview() {
    if (!videoPreviewGrid) return;
    videoPreviewGrid.innerHTML = "";

    if (!videoFile) {
      videoUploadTile?.classList.remove("hidden");
      return;
    }

    videoUploadTile?.classList.add("hidden");

    const card = document.createElement("div");
    card.className = "preview-card";

    const img = document.createElement("img");
    img.className = "preview-image";
    img.alt = "Референс для видео";
    const objectUrl = URL.createObjectURL(videoFile);
    img.src = objectUrl;
    img.onload = () => URL.revokeObjectURL(objectUrl);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "preview-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "Удалить референс");
    removeButton.addEventListener("click", () => {
      videoFile = null;
      if (videoFileInput) videoFileInput.value = "";
      renderVideoPreview();
    });

    card.append(img, removeButton);
    videoPreviewGrid.append(card);
  }

  function setSound(value) {
    videoSound = Boolean(value);
    soundOffBtn?.classList.toggle("active", !videoSound);
    soundOnBtn?.classList.toggle("active", videoSound);
    refreshVideoButtonLabel();
  }

  function setDuration(value) {
    videoDuration = String(value) === "10" ? "10" : "5";
    duration5Btn?.classList.toggle("active", videoDuration === "5");
    duration10Btn?.classList.toggle("active", videoDuration === "10");
    refreshVideoButtonLabel();
  }

  function clearPoll() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function resetVideoState() {
    clearPoll();
    videoFile = null;
    videoSound = false;
    videoDuration = "5";
    if (videoFileInput) videoFileInput.value = "";
    setSound(false);
    setDuration("5");
    renderVideoPreview();
  }

  function setResultLoadingVideo(copy) {
    if (resultLoadingTitle) {
      resultLoadingTitle.textContent = copy || "Генерация видео...";
    }
  }

  function showVideoResult(url) {
    window.__nanoHideLoadingResult?.();
    window.__nanoSetLoadingState?.(false);

    resultPlaceholder?.classList.add("hidden");
    document.getElementById("result-image")?.classList.add("hidden");
    document.getElementById("result-gallery")?.classList.add("hidden");

    if (resultVideo) {
      resultVideo.classList.remove("hidden");
      resultVideo.src = url;
    }

    if (downloadLink) {
      downloadLink.href = url;
      downloadLink.download = `nano-banana-video-${Date.now()}.mp4`;
      downloadLink.classList.remove("hidden");
    }
    resetButton?.classList.remove("hidden");
  }

  /**
   * Опрос KIE только после createTask; загрузка на tmpfiles — на сервере
   * внутри POST /api/generate-video/start при нажатии «Сгенерировать».
   */
  function pollUntilDone(taskId) {
    clearPoll();
    let tickCount = 0;

    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          tickCount += 1;
          if (tickCount > MAX_POLL_TICKS) {
            clearPoll();
            window.__nanoHideLoadingResult?.();
            window.__nanoSetLoadingState?.(false);
            showToast(
              "Превышено время ожидания видео. Проверьте позже или создайте задачу снова.",
              "warning"
            );
            resolve();
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
              await window.__nanoOpenBillingModal?.({
                silentPricingErrors: true,
              });
              throw new Error("INSUFFICIENT_BALANCE");
            }
            throw new Error(data?.error || "Ошибка статуса видео.");
          }

          if (data?.state === "success" && data?.videoUrl) {
            clearPoll();
            if (typeof data.balance === "number") {
              window.__nanoGenerateContext?.applyBalanceFromServer?.(
                data.balance
              );
            }
            showToast("Видео готово", "success");
            showVideoResult(data.videoUrl);
            resolve();
            return;
          }

          if (data?.state === "failed") {
            clearPoll();
            window.__nanoHideLoadingResult?.();
            window.__nanoSetLoadingState?.(false);
            showToast(data?.error || "Ошибка генерации видео.", "error");
            resolve();
            return;
          }

          pollTimer = window.setTimeout(tick, POLL_MS);
        } catch (error) {
          clearPoll();
          window.__nanoHideLoadingResult?.();
          window.__nanoSetLoadingState?.(false);
          reject(error);
        }
      };

      pollTimer = window.setTimeout(tick, 0);
    });
  }

  async function handleVideoSubmit() {
    const c = ctx();
    if (!c?.authStateResolved || c.isAuthResolving) {
      showToast("Проверяем аккаунт, пожалуйста подожди.", "info");
      return;
    }

    if (!c.currentAuthState) {
      window.__nanoOpenAuthModal?.();
      showToast(
        "Сначала войди через Telegram или Google, затем повтори генерацию.",
        "warning"
      );
      return;
    }

    const balance = c.getCurrentBalanceByVersion(
      c.currentAuthState,
      c.selectedVersion
    );
    const cost = getVideoCost(videoSound, videoDuration);

    if (Number.isFinite(balance) && balance <= 0) {
      await window.__nanoOpenBillingModal?.({ silentPricingErrors: true });
      showToast(
        "Недостаточно генераций. Пополни баланс, чтобы продолжить.",
        "warning"
      );
      return;
    }

    if (Number.isFinite(balance) && balance < cost) {
      await window.__nanoOpenBillingModal?.({ silentPricingErrors: true });
      showToast(
        "Недостаточно генераций для выбранных параметров видео.",
        "warning"
      );
      return;
    }

    const prompt = promptInput?.value.trim();
    if (!prompt) {
      showToast("Введите текст промпта.", "warning");
      return;
    }

    if (!videoFile) {
      showToast("Загрузите одно изображение-референс.", "warning");
      return;
    }

    const fileToBase64 = window.__nanoFileToBase64;
    if (typeof fileToBase64 !== "function") {
      showToast("Внутренняя ошибка: нет конвертера изображений.", "error");
      return;
    }

    try {
      window.__nanoSetLoadingState?.(true);
      window.__nanoShowLoadingResult?.();
      window.__nanoHideResult?.();
      setResultLoadingVideo(
        "Генерация видео... Это может занять несколько минут."
      );

      const imagePayload = await fileToBase64(videoFile);

      const { response, data: startData } = await fetchApiJson(
        "/api/generate-video/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: c.selectedVersion,
            prompt,
            sound: videoSound,
            duration: videoDuration,
            imageBase64: imagePayload.data,
            mimeType: imagePayload.mimeType || "image/jpeg",
          }),
        }
      );

      if (!response.ok) {
        if (
          response.status === 402 ||
          startData?.code === "INSUFFICIENT_BALANCE"
        ) {
          await window.__nanoOpenBillingModal?.({ silentPricingErrors: true });
          throw new Error("INSUFFICIENT_BALANCE");
        }
        if (response.status === 422 || startData?.code === "PROMPT_BLOCKED") {
          throw new Error(startData?.error || "Запрос не прошёл проверку.");
        }
        if (startData?.code === "TMPFILES_UPLOAD_FAILED") {
          throw new Error("Не удалось загрузить картинку.");
        }
        throw new Error(
          startData?.error || "Не удалось запустить генерацию видео."
        );
      }

      const taskId = startData?.taskId;
      if (!taskId) {
        throw new Error("Сервер не вернул идентификатор задачи.");
      }

      setResultLoadingVideo("Видео создаётся. Ожидание примерно 2-5 минут...");
      showToast("Задача создана, ждём готовности...", "info");
      await pollUntilDone(taskId);
    } catch (error) {
      window.__nanoHideLoadingResult?.();
      window.__nanoSetLoadingState?.(false);
      const msg = String(error?.message || "");
      if (msg === "INSUFFICIENT_BALANCE") {
        showToast("Недостаточно генераций. Пополните баланс.", "warning");
      } else {
        showToast(msg || "Ошибка генерации видео.", "error");
      }
    }
  }

  function onFormSubmitCapture(event) {
    if (mode !== MODE_VIDEO) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void handleVideoSubmit();
  }

  tabImage?.addEventListener("click", () => switchMode(MODE_IMAGE));
  tabVideo?.addEventListener("click", () => switchMode(MODE_VIDEO));

  videoFileInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    videoFile = file || null;
    renderVideoPreview();
    if (videoFileInput) videoFileInput.value = "";
  });

  soundOffBtn?.addEventListener("click", () => setSound(false));
  soundOnBtn?.addEventListener("click", () => setSound(true));
  duration5Btn?.addEventListener("click", () => setDuration("5"));
  duration10Btn?.addEventListener("click", () => setDuration("10"));

  form?.addEventListener("submit", onFormSubmitCapture, true);

  try {
    const saved = localStorage.getItem(GENERATOR_MODE_STORAGE_KEY);
    if (saved === MODE_VIDEO) {
      switchMode(MODE_VIDEO);
    }
  } catch (_) {
    /* ignore */
  }

  window.__nanoGenerateHooks.getMode = () => mode;
  window.__nanoGenerateHooks.refreshLabel = function () {
    if (mode === MODE_VIDEO) refreshVideoButtonLabel();
  };
  window.__nanoGenerateHooks.resetVideo = function () {
    resetVideoState();
  };

  setPlaceholderText();
  updatePromptsButtonVisibility();

  window.addEventListener("pageshow", (ev) => {
    if (!ev.persisted) return;
    clearPoll();
    window.__nanoHideLoadingResult?.();
    window.__nanoSetLoadingState?.(false);
    window.__nanoUpdateGenerateButtonAvailability?.();
  });
})();
