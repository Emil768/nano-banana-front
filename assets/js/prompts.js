(function () {
  const API_BASE_URL = (
    window.NANO_API_BASE_URL ||
    (window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://127.0.0.1:3000"
      : "https://nanobananaa.up.railway.app")
  ).replace(/\/$/, "");

  const promptInput = document.getElementById("prompt");
  const chooseLookButton = document.getElementById("prompts-button");
  const promptsModal = document.getElementById("prompts-modal");
  const promptsModalCloseButton = document.getElementById(
    "prompts-modal-close"
  );
  const promptsModalBackdrop = document.querySelector(
    "[data-close-prompts-modal]"
  );
  const promptsCategories = document.getElementById("prompts-categories");
  const promptsGrid = document.getElementById("prompts-grid");
  const promptsLoading = document.getElementById("prompts-loading");

  let promptsLibrary = [];
  let promptsActiveCategory = "Все";
  let isPromptsLoading = false;

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", doInit);
    } else {
      doInit();
    }
  }

  function doInit() {
    if (!chooseLookButton || !promptsModal || !promptInput || !promptsGrid)
      return;

    chooseLookButton.addEventListener("click", openPromptsModal);
    promptsModalCloseButton?.addEventListener("click", closePromptsModal);
    promptsModalBackdrop?.addEventListener("click", closePromptsModal);

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        !promptsModal.classList.contains("hidden")
      ) {
        closePromptsModal();
      }
    });
  }

  async function openPromptsModal() {
    promptsModal.classList.remove("hidden");
    promptsModal.setAttribute("aria-hidden", "false");

    if (!promptsLibrary.length && !isPromptsLoading) {
      try {
        isPromptsLoading = true;

        promptsLoading.classList.remove("hidden");
        promptsLoading.innerHTML = `
          <div class="loader-container">
            <div class="loader-spinner"></div>
            <span>Загрузка промптов...</span>
          </div>
        `;

        promptsCategories.classList.add("hidden");
        promptsGrid.classList.add("hidden");

        promptsLibrary = await fetchPromptsLibrary();
        promptsActiveCategory = "Все";

        promptsLoading.classList.add("hidden");

        promptsCategories.classList.remove("hidden");
        promptsGrid.classList.remove("hidden");

        renderPromptsCategories();
        renderPromptsGrid();
      } catch (error) {
        promptsLoading.classList.add("hidden");
        promptsCategories.classList.add("hidden");
        promptsGrid.classList.remove("hidden");

        promptsGrid.innerHTML = `
          <div class="prompts-empty">
            <span class="error-icon">⚠️</span>
            <p>Ошибка загрузки промптов</p>
            <button class="retry-button" onclick="location.reload()">Обновить страницу</button>
          </div>
        `;

        if (typeof window.showToast === "function") {
          window.showToast("Ошибка загрузки промптов", "error");
        }
      } finally {
        isPromptsLoading = false;
      }
      return;
    }

    promptsCategories.classList.remove("hidden");
    promptsGrid.classList.remove("hidden");
    promptsLoading.classList.add("hidden");

    renderPromptsCategories();
    renderPromptsGrid();
  }

  function closePromptsModal() {
    promptsModal.classList.add("hidden");
    promptsModal.setAttribute("aria-hidden", "true");
  }

  async function fetchPromptsLibrary() {
    const response = await fetch(`${API_BASE_URL}/api/prompts`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  function getPromptCategories() {
    const categories = Array.from(
      new Set(
        promptsLibrary
          .map((item) => String(item?.category || "").trim())
          .filter(Boolean)
      )
    );
    return ["Все", ...categories];
  }

  function renderPromptsCategories() {
    if (!promptsCategories) return;

    const categories = getPromptCategories();
    promptsCategories.innerHTML = "";

    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "prompts-category-btn";
      button.textContent = category;
      if (category === promptsActiveCategory) button.classList.add("active");

      button.addEventListener("click", () => {
        promptsActiveCategory = category;
        renderPromptsCategories();
        renderPromptsGrid();
      });

      promptsCategories.appendChild(button);
    });
  }

  function renderPromptsGrid() {
    if (!promptsGrid) return;

    const items = promptsLibrary.filter((item) => {
      if (promptsActiveCategory === "Все") return true;
      return String(item?.category || "") === promptsActiveCategory;
    });

    promptsGrid.innerHTML = "";

    if (!items.length) {
      promptsGrid.innerHTML =
        '<div class="prompts-empty">Нет промптов в этой категории</div>';
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "prompt-card";

      card.innerHTML = `
        <img src="${item.url || ""}" alt="${
        item.category || ""
      }" class="prompt-card__image" onerror="this.style.display='none'">
        <div class="prompt-card__body">
          <div class="prompt-card__meta">
            <span class="prompt-card__badge">${item.category || ""}</span>
          </div>
          <p class="prompt-card__text" title="${(item.promt || "").replace(
            /"/g,
            "&quot;"
          )}">${item.promt || ""}</p>
          <button type="button" class="prompt-card__apply">Применить</button>
        </div>
      `;

      const applyBtn = card.querySelector(".prompt-card__apply");
      applyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        applyPrompt(item);
      });

      promptsGrid.appendChild(card);
    });
  }

  function applyPrompt(item) {
    promptInput.value = item.promt || "";
    promptInput.focus();
    promptInput.scrollIntoView({ behavior: "smooth", block: "center" });
    closePromptsModal();
    if (typeof window.showToast === "function")
      window.showToast("Промпт применен!", "success");
  }

  init();
})();
