// Страница /promty/: каталог «Обработка своего фото» — текстовые промты
// с [местами для замены].
// Карточки уже в разметке (собраны scripts/build-site.mjs) — здесь только поведение.
(function () {
  const editGrid = document.getElementById("edit-grid");
  if (!editGrid) return;

  const editCards = Array.from(editGrid.querySelectorAll(".ecard"));
  const search = document.getElementById("promty-search");
  const toast = document.getElementById("toast");

  let editCat = "";
  let toastTimer = null;
  let lastFocus = null;

  /* ---------- Общее ---------- */

  // Промт уходит в генератор на главной через ?prompt= (главная подставит его,
  // выделит первое [место для замены] и уберёт параметр из адреса).
  // Ссылками не делаем — сотня длинных URL в индексе ни к чему.
  const tryPrompt = (text) => {
    window.location.href = `/?prompt=${encodeURIComponent(text)}`;
  };

  // Поиск без учёта регистра, ё = е
  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-on"), 1800);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API недоступен (не https или нет разрешения) — старый способ
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }

  async function copyWithToast(text) {
    const ok = await copy(text);
    showToast(ok ? "Промт скопирован" : "Не удалось скопировать");
  }

  function openModal(modal) {
    lastFocus = document.activeElement;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    modal.querySelector(".modal__close")?.focus();
  }

  function closeModal(modal) {
    if (!modal || modal.classList.contains("hidden")) return false;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    lastFocus?.focus?.();
    return true;
  }

  function bindTabs(root, selector, onPick) {
    root?.addEventListener("click", (event) => {
      const tab = event.target.closest(selector);
      if (!tab) return;
      root.querySelectorAll(selector).forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-on", on);
        t.setAttribute("aria-pressed", String(on));
      });
      onPick(tab.dataset.ecat ?? tab.dataset.cat ?? "");
    });
  }

  /* ---------- Фильтр: поиск + категории ---------- */

  const editHay = new Map(
    editCards.map((c) => [c, norm(`${c.textContent} ${c.dataset.en || ""}`)])
  );

  function filterList(cards, hay, catKey, cat, words, empty) {
    let shown = 0;
    cards.forEach((card) => {
      const visible =
        (!cat || card.dataset[catKey] === cat) &&
        words.every((w) => hay.get(card).includes(w));
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    if (empty) empty.hidden = shown > 0 || !cards.length;
  }

  function applyFilter() {
    const words = norm(search?.value).split(/\s+/).filter(Boolean);
    filterList(editCards, editHay, "ecat", editCat, words, document.getElementById("edit-empty"));
  }

  search?.addEventListener("input", applyFilter);
  bindTabs(document.getElementById("edit-cats"), ".etab", (cat) => {
    editCat = cat;
    applyFilter();
  });

  /* ---------- Обработка своего фото ---------- */

  const editModal = document.getElementById("edit-modal");
  const editText = document.getElementById("edit-modal-text");
  let editCurrent = null;
  let editLang = "ru";

  const promptOf = (card, lang = editLang) =>
    (lang === "en" ? card.dataset.en : card.dataset.ru) || "";

  // [место для замены] → подсветка; текст вставляем безопасно, через узлы
  function renderSlots(target, text) {
    target.textContent = "";
    text.split(/(\[[^\]]+\])/).forEach((part) => {
      if (!part) return;
      if (/^\[[^\]]+\]$/.test(part)) {
        const mark = document.createElement("mark");
        mark.textContent = part;
        target.appendChild(mark);
      } else {
        target.appendChild(document.createTextNode(part));
      }
    });
  }

  function setEditLang(lang) {
    editLang = lang === "en" ? "en" : "ru";
    editModal?.querySelectorAll("[data-elang]").forEach((btn) => {
      const on = btn.dataset.elang === editLang;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", String(on));
    });
    if (editCurrent) renderSlots(editText, promptOf(editCurrent));
  }

  function openEdit(card, { updateHash = true } = {}) {
    if (!editModal) return;
    editCurrent = card;

    document.getElementById("edit-modal-ic").innerHTML =
      card.querySelector(".ecard__ic")?.innerHTML || "";
    document.getElementById("edit-modal-cat").textContent =
      card.querySelector(".ecard__cat")?.textContent || "";
    document.getElementById("edit-modal-title").textContent =
      card.querySelector(".ecard__title")?.textContent.trim() || "Промт";
    document.getElementById("edit-modal-desc").textContent =
      card.querySelector(".ecard__desc")?.textContent || "";

    const badge = document.getElementById("edit-modal-badge");
    const images = Number(card.dataset.images) || 1;
    badge.hidden = images < 2;
    badge.textContent = images < 2 ? "" : `Нужно ${images} фото`;

    setEditLang(editLang);
    openModal(editModal);

    // Своя ссылка на каждый промт: /promty/#zamenit-fon
    if (updateHash && card.dataset.slug) {
      history.replaceState(null, "", `#${card.dataset.slug}`);
    }
  }

  function closeEdit() {
    if (!closeModal(editModal)) return;
    editCurrent = null;
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  editGrid?.addEventListener("click", (event) => {
    const card = event.target.closest(".ecard");
    if (!card) return;
    if (event.target.closest("[data-etry]")) tryPrompt(promptOf(card, "ru"));
    else if (event.target.closest("[data-ecopy]")) void copyWithToast(promptOf(card, "ru"));
    else if (event.target.closest("[data-eopen]")) openEdit(card);
  });

  editModal?.querySelectorAll("[data-elang]").forEach((btn) =>
    btn.addEventListener("click", () => setEditLang(btn.dataset.elang))
  );
  document.getElementById("edit-modal-try")?.addEventListener("click", () => {
    if (editCurrent) tryPrompt(promptOf(editCurrent));
  });
  document.getElementById("edit-modal-copy")?.addEventListener("click", () => {
    if (editCurrent) void copyWithToast(promptOf(editCurrent));
  });
  editModal?.querySelectorAll("[data-close-edit-modal]").forEach((el) =>
    el.addEventListener("click", closeEdit)
  );

  // Пришли по ссылке /promty/#slug — сразу открываем этот промт.
  // У карточек нет id = slug нарочно: иначе браузер прыгает к якорю под модалкой.
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const hashCard = fromHash
    ? editCards.find((card) => card.dataset.slug === fromHash)
    : null;
  if (hashCard) openEdit(hashCard, { updateHash: false });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeEdit();
  });
})();
