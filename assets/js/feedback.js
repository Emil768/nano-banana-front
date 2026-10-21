(() => {
  const FALLBACK_API_BASE_URL =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
      ? "http://127.0.0.1:3000"
      : "https://emil768-nano-banana-api-a16c.twc1.net";

  const API_BASE_URL = (
    window.NANO_API_BASE_URL || FALLBACK_API_BASE_URL
  ).replace(/\/$/, "");

  const RATING_LABELS = ["Плохо", "Так себе", "Нормально", "Хорошо", "Отлично"];
  const DEFAULT_RATING_LABEL = "Выберите оценку";
  const SUBMIT_LABEL = "Отправить отзыв";
  const SUBMITTING_LABEL = "Отправляем…";

  const params = new URLSearchParams(window.location.search);
  const usernameFromUrl = (params.get("username") || "")
    .trim()
    .replace(/^@+/, "");
  const chatIdRaw = (params.get("chat_id") || params.get("chatId") || "").trim();

  const formCard = document.getElementById("feedback-form-card");
  const successCard = document.getElementById("feedback-success");
  const form = document.getElementById("feedback-form");
  const usernameInput = document.getElementById("feedback-username");
  const starsWrap = document.getElementById("feedback-stars");
  const ratingLabel = document.getElementById("feedback-rating-label");
  const likedInput = document.getElementById("feedback-liked");
  const improveInput = document.getElementById("feedback-improve");
  const errorEl = document.getElementById("feedback-error");
  const submitBtn = document.getElementById("feedback-submit");
  const submitLabel = submitBtn?.querySelector(".fb-submit__label");

  let rating = 0;
  let hoverRating = 0;
  let isSubmitting = false;

  if (usernameInput && usernameFromUrl) {
    usernameInput.value = `@${usernameFromUrl}`;
  }

  function paintStars() {
    if (!starsWrap) return;
    starsWrap.querySelectorAll(".fb-star").forEach((btn) => {
      const value = Number(btn.dataset.value);
      btn.classList.toggle("is-active", value <= rating);
      btn.classList.toggle("is-hover", hoverRating > 0 && value <= hoverRating);
      btn.setAttribute("aria-checked", value === rating ? "true" : "false");
    });

    if (ratingLabel) {
      const shown = hoverRating || rating;
      ratingLabel.textContent = shown
        ? RATING_LABELS[shown - 1]
        : DEFAULT_RATING_LABEL;
      ratingLabel.classList.toggle("is-set", shown > 0);
    }
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    if (!errorEl) return;
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  function setSubmitting(on) {
    isSubmitting = on;
    if (!submitBtn) return;
    submitBtn.disabled = on;
    submitBtn.classList.toggle("is-loading", on);
    if (submitLabel) {
      submitLabel.textContent = on ? SUBMITTING_LABEL : SUBMIT_LABEL;
    }
  }

  starsWrap?.addEventListener("click", (event) => {
    const btn = event.target.closest(".fb-star");
    if (!btn) return;
    rating = Number(btn.dataset.value) || 0;
    clearError();
    paintStars();
  });

  starsWrap?.addEventListener("mouseover", (event) => {
    const btn = event.target.closest(".fb-star");
    if (!btn) return;
    hoverRating = Number(btn.dataset.value) || 0;
    paintStars();
  });

  starsWrap?.addEventListener("mouseleave", () => {
    hoverRating = 0;
    paintStars();
  });

  [likedInput, improveInput].forEach((input) =>
    input?.addEventListener("input", () => {
      if (!errorEl?.hidden) clearError();
    })
  );

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    clearError();

    if (!rating || rating < 1 || rating > 5) {
      showError("Поставьте оценку — без неё отзыв не отправится");
      starsWrap?.querySelector(".fb-star")?.focus();
      return;
    }

    const liked = (likedInput?.value || "").trim();
    const improve = (improveInput?.value || "").trim();

    if (!liked && !improve) {
      showError(
        "Напишите хотя бы в одном поле, что понравилось или что улучшить."
      );
      likedInput?.focus();
      return;
    }

    const username = (usernameInput?.value || "").trim().replace(/^@+/, "");

    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: username || null,
          chat_id: chatIdRaw || null,
          rating,
          liked,
          improve,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось отправить отзыв.");
      }

      formCard?.classList.add("hidden");
      successCard?.classList.remove("hidden");
      successCard?.focus();
    } catch (error) {
      showError(error?.message || "Не удалось отправить отзыв.");
      setSubmitting(false);
    }
  });

  paintStars();
})();
