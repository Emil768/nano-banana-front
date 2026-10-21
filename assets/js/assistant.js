// Страница /assistant/: чат с ИИ-ассистентом (POST /api/assistant/chat, ответ — SSE).
// Вход, сессия, адрес API и модалка оплаты — из index.js (apiBase, getSessionToken,
// fetchAuthMeCached, openAuthModal, openBillingModal, fileToJpegBase64), он подключён раньше.
(function () {
  const root = document.getElementById("asst");
  if (!root) return;

  const $ = (id) => document.getElementById(id);
  const side = $("asst-side");
  const scrim = root.querySelector(".asst-scrim");
  const chatsEl = $("asst-chats");
  const usageEl = $("asst-usage");
  const mbar = $("asst-mbar");
  const feed = $("asst-feed");
  const feedIn = $("asst-feed-in");
  const emptyEl = $("asst-empty");
  const titleEl = $("asst-title");
  const form = $("asst-form");
  const input = $("asst-msg");
  const sendBtn = $("asst-send");
  const fileInput = $("asst-file");
  const attachList = $("asst-attach-list");
  const toast = $("toast");

  const MAX_CHARS = 2000;
  const MAX_IMAGES = 4; // как на обычной генерации
  let IMAGE_TTL_DAYS = 5; // столько бэк хранит картинки; точное значение придёт в /state
  const MAX_FILES = 3; // документов / файлов с кодом на сообщение
  const UNSUPPORTED_HINT =
    "Такой формат пока не читаю. Подойдут фото, PDF, Word (DOCX), Excel (XLSX), CSV, TXT и файлы с кодом";
  const isPhoto = (file) => /^image\/(png|jpe?g|webp)$/i.test(file?.type || "");
  // Как на бэке (assistant-files.js): документы и всё, что читается как текст
  const READABLE_EXT = new Set(
    (
      "pdf docx xlsx txt md markdown csv tsv json jsonl xml yml yaml toml ini cfg conf log env sql " +
      "js mjs cjs jsx ts tsx vue svelte html htm css scss sass less " +
      "py rb php java kt kts swift go rs c h cpp hpp cc cs m mm scala dart lua pl r " +
      "sh bash zsh ps1 bat gradle graphql proto tex srt vtt"
    ).split(" ")
  );
  const isReadableFile = (file) => {
    const name = String(file?.name || "").toLowerCase();
    if (name === "dockerfile" || name === "makefile") return true;
    return READABLE_EXT.has(name.includes(".") ? name.split(".").pop() : "");
  };
  const LOGO_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1C1B18" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M6 11c1.5 4 6 6 10 3 1-.8 1.8-1.8 2-3"/></svg>';

  let authed = false;
  let conversationId = null;
  let conversations = [];
  let sending = false;
  let blocked = false;
  /** @type {{ id: number, url: string, preview: string, uploading: boolean }[]} */
  let attachments = [];
  let attachSeq = 0;
  let toastTimer = null;

  /* ---------- Мелочи ---------- */

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-on"), 2200);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function authHeaders(json = true) {
    const headers = new Headers();
    headers.set("Accept", json ? "application/json" : "text/event-stream");
    const token = getSessionToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  async function api(path, options = {}) {
    const headers = authHeaders();
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase()}${path}`, {
      credentials: "include",
      ...options,
      headers,
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return { ok: response.ok, status: response.status, data };
  }

  function openPlans() {
    closeDrawer();
    void openBillingModal({ silentPricingErrors: true });
  }

  let openedAt = 0; // только что открыли диалог — картинки догружаются, держим низ

  function scrollToBottom(force = false) {
    if (Date.now() - openedAt < 4000) force = true;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
    if (force || nearBottom) feed.scrollTop = feed.scrollHeight;
  }

  function formatWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (days === 0) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "Вчера";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  }

  /** Время по Москве: 18:40 */
  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  }

  function formatDay(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
  }

  /* ---------- Выдвижная панель (мобила) ---------- */

  function openDrawer() {
    side.classList.add("is-open");
    scrim.classList.add("is-open");
    root.querySelector("[data-asst-open]")?.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    side.classList.remove("is-open");
    scrim.classList.remove("is-open");
    root.querySelector("[data-asst-open]")?.setAttribute("aria-expanded", "false");
  }

  // Навигация сайта в панели — копия основного сайдбара, без дублирования вёрстки
  function mountSiteNav() {
    const nav = document.querySelector("#sidebar .nav");
    const target = $("asst-side-nav");
    if (!nav || !target) return;
    Array.from(nav.children).forEach((child) => {
      const copy = child.cloneNode(true);
      copy.removeAttribute("title");
      target.appendChild(copy);
    });
    target.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeDrawer));
  }

  /* ---------- Баланс и использование ---------- */

  function setBalance(value) {
    if (value == null) return;
    root.querySelectorAll("[data-asst-balance]").forEach((node) => {
      node.textContent = String(value);
    });
  }

  function setModelLabel(label) {
    if (!label) return;
    root.querySelectorAll("[data-asst-model]").forEach((node) => {
      node.textContent = label;
    });
  }

  function bar(percent) {
    const wrap = el("div", "asst-bar");
    const fill = el("div", "asst-bar__fill");
    fill.style.width = `${percent}%`;
    fill.classList.toggle("is-hot", percent >= 90);
    wrap.appendChild(fill);
    return wrap;
  }

  function tierRow(label) {
    const row = el("div", "asst-usage__tier");
    const left = el("span");
    // 💎 — платный уровень, ✦ — базовый (как в модалке оплаты)
    const paid = label !== "Базовый";
    left.append("Тариф: ", el("strong", "", `${paid ? "💎" : "✦"} ${label}`));
    row.append(left, button("b b--y b--s b--full asst-usage__btn", "Обновить тариф", openPlans));
    return row;
  }

  function renderGuestUsage() {
    usageEl.textContent = "";
    usageEl.append(
      el("strong", "", "ИИ-ассистент"),
      el("span", "asst-usage__muted", "Войди, чтобы начать: пробный доступ бесплатный."),
      button("b b--g b--s b--full", "Войти", () => {
        closeDrawer();
        openAuthModal();
      })
    );
    mbar.hidden = true;
  }

  function renderUsage(state) {
    if (!state) return;
    usageEl.textContent = "";
    const pct = Math.max(0, Math.min(100, Number(state.percent) || 0));
    const head = el("div", "asst-usage__row");

    const resetLabel = state.window_resets_at
      ? `Обновится в ${formatTime(state.window_resets_at)}`
      : "Лимит полный";

    if (state.mode === "tier") {
      head.append(el("span", "asst-usage__muted", "Использовано"), el("strong", "", `${pct}%`));
      usageEl.append(
        head,
        bar(pct),
        el("span", "asst-usage__muted", `${resetLabel} · до ${formatDay(state.tier_until)}`),
        tierRow(state.tier_label)
      );
    } else {
      const label = el("span", "asst-usage__muted", "Пробный доступ: использовано ");
      label.appendChild(el("strong", "", `${pct}%`));
      head.appendChild(label);
      usageEl.append(
        head,
        bar(pct),
        tierRow("Базовый")
      );
    }

    // Полоска под шапкой на мобиле
    mbar.hidden = false;
    mbar.querySelector("[data-usage-label]").textContent =
      state.mode === "tier" ? resetLabel : "Пробный доступ";
    const fill = mbar.querySelector("[data-usage-fill]");
    fill.style.width = `${pct}%`;
    fill.classList.toggle("is-hot", pct >= 90);
    mbar.querySelector("[data-usage-pct]").textContent = `${pct}%`;

    setBlocked(Boolean(state.blocked), state);
    scheduleWindowReset(state);
  }

  // Окно истекло — перезапрашиваем состояние: лимит снова полный, ввод разблокирован
  let windowTimer = null;
  function scheduleWindowReset(state) {
    window.clearTimeout(windowTimer);
    const at = Date.parse(state?.window_resets_at || "");
    if (!Number.isFinite(at)) return;
    const delay = Math.max(1000, at - Date.now() + 1500);
    if (delay < 2 ** 31) windowTimer = window.setTimeout(() => void loadState(), delay);
  }

  /* ---------- Блокировка ввода ---------- */

  function setBlocked(on, state) {
    blocked = on;
    form.classList.toggle("is-disabled", on);
    input.disabled = on;
    $("asst-attach").disabled = on;
    updateSendButton();
    feedIn.querySelector(".asst-note--limit")?.remove();
    if (!on) return;

    const trial = state?.mode !== "tier";
    const hardCap = state?.block_reason === "hard_cap";
    const resetAt = state?.window_resets_at ? formatTime(state.window_resets_at) : "";
    const title = hardCap
      ? "На сегодня хватит"
      : trial
        ? "Пробный доступ закончился"
        : `Лимит исчерпан${resetAt ? `, обновится в ${resetAt}` : ""}`;
    const text = hardCap
      ? "Ассистент снова заработает завтра в 00:00 МСК."
      : trial
        ? "Ассистент на 30 дней открывается в пакетах от 499 ₽. Генерации из пакета не сгорают."
        : "Больше запросов за 5 часов — в пакетах Мега и Ультра.";
    const note = noteCard(title, text, hardCap ? null : ["Выбрать пакет", openPlans]);
    note.classList.add("asst-note--limit");
    feedIn.appendChild(note);
    scrollToBottom(true);
  }

  function noteCard(title, text, action, isError = false) {
    const note = el("div", `asst-note${isError ? " asst-note--err" : ""}`);
    note.append(el("strong", "", title));
    if (text) note.append(el("p", "", text));
    if (action) note.append(button("b b--y b--s", action[0], action[1]));
    return note;
  }

  /* ---------- Лента ---------- */

  // Приветствие — первое «сообщение» нового чата. В открытых старых чатах его нет.
  function hideEmpty() {}

  function renderGreeting(name) {
    const box = $("asst-greeting-text");
    if (!box) return;
    box.textContent = "";
    box.append(
      el("strong", "", name ? `Привет, ${name}!` : "Привет!"),
      " Я Банана — твой личный ИИ-помощник.\n\n" +
        "Спрашивай что угодно: помогу с текстом, идеей, учёбой или работой, переведу, объясню, подскажу.\n\n" +
        "А ещё у меня суперсила — фото: опиши словами, что хочешь, и я сам соберу промт и сгенерирую картинку. " +
        "Могу улучшить твой промт или разобрать фото, которое пришлёшь.\n\n" +
        "С чего начнём?"
    );
  }

  function clearFeed(showGreeting = true) {
    Array.from(feedIn.children).forEach((child) => {
      if (child !== emptyEl) child.remove();
    });
    emptyEl.hidden = !showGreeting;
  }

  /** photos — [{ url, preview_url }]; expiredCount — сколько фото уже удалено по сроку. */
  function addUserMessage(text, photos = [], expiredCount = 0, files = []) {
    hideEmpty();
    const row = el("div", "asst-msg asst-msg--user");
    const body = el("div", "asst-msg__body");
    if (photos.length) {
      const wrap = el("div", "asst-msg__photos");
      photos.forEach((p) => {
        const img = el("img", "asst-msg__photo");
        img.src = p.preview_url || p.url;
        img.alt = "Фото к сообщению";
        img.loading = "lazy";
        img.addEventListener("error", refreshLinksOnce);
        if (p.url) {
          img.addEventListener("click", () => {
            if (typeof openResultModal === "function") openResultModal(p.url);
          });
        }
        wrap.appendChild(img);
      });
      body.appendChild(wrap);
    }
    if (expiredCount > 0) {
      body.appendChild(
        el("div", "asst-msg__expired", `${expiredCount === 1 ? "Фото удалено" : `Фото удалены (${expiredCount})`} — храним ${IMAGE_TTL_DAYS} дней`)
      );
    }
    if (files.length) {
      const wrap = el("div", "asst-msg__files");
      files.forEach((f) => wrap.appendChild(fileChip(f)));
      body.appendChild(wrap);
    }
    body.appendChild(el("div", "asst-bubble", text));
    row.appendChild(body);
    feedIn.appendChild(row);
    return row;
  }

  /* ---------- Разметка ответов: markdown без HTML от модели ---------- */

  const escHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const linkHtml = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

  // Голая ссылка → короткая подпись: nanobananaa.ru/ozhivit-foto
  const shortUrl = (url) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

  // Строчная разметка поверх уже экранированного текста
  function mdInline(s) {
    const slots = [];
    const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let out = s
      .replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`))
      // [текст](https://…) — ссылка с подписью
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, href) => hold(linkHtml(href, text)))
      // голые https://… — тоже кликабельны (без хвостовой пунктуации)
      .replace(/https?:\/\/[^\s<]+[^\s<.,!?:;)»"']/g, (href) => hold(linkHtml(href, shortUrl(href))));
    out = out
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[i]);
  }

  function mdBlocks(text) {
    const lines = escHtml(text).split("\n");
    const html = [];
    let list = null; // "ul" | "ol"
    let para = [];
    const flushPara = () => {
      if (para.length) html.push(`<p>${mdInline(para.join("<br>"))}</p>`);
      para = [];
    };
    const closeList = () => {
      if (list) html.push(`</${list}>`);
      list = null;
    };
    for (const line of lines) {
      let m;
      if (!line.trim()) {
        flushPara();
        closeList();
      } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        flushPara();
        closeList();
        html.push(`<h4>${mdInline(m[2])}</h4>`);
      } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
        flushPara();
        if (list !== "ul") {
          closeList();
          html.push("<ul>");
          list = "ul";
        }
        html.push(`<li>${mdInline(m[1])}</li>`);
      } else if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
        flushPara();
        if (list !== "ol") {
          closeList();
          html.push(`<ol start="${m[1]}">`);
          list = "ol";
        }
        html.push(`<li>${mdInline(m[2])}</li>`);
      } else if ((m = /^&gt;\s?(.*)$/.exec(line))) {
        flushPara();
        closeList();
        html.push(`<blockquote>${mdInline(m[1])}</blockquote>`);
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara();
    closeList();
    return html.join("");
  }

  const CODE_EXT = {
    javascript: "js", js: "js", typescript: "ts", ts: "ts", jsx: "jsx", tsx: "tsx", python: "py", py: "py",
    html: "html", css: "css", scss: "scss", json: "json", bash: "sh", sh: "sh", shell: "sh", sql: "sql",
    java: "java", kotlin: "kt", swift: "swift", go: "go", rust: "rs", php: "php", ruby: "rb", c: "c",
    cpp: "cpp", csharp: "cs", cs: "cs", yaml: "yml", yml: "yml", xml: "xml", markdown: "md", md: "md", vue: "vue",
  };

  /** Текст ответа → HTML. Незакрытый ``` (идёт стрим) показываем как код до конца. */
  function renderMarkdown(text) {
    const parts = String(text || "").split(/^```/m);
    let html = "";
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        html += mdBlocks(part);
        return;
      }
      const nl = part.indexOf("\n");
      const lang = (nl >= 0 ? part.slice(0, nl) : part).trim().toLowerCase();
      const code = nl >= 0 ? part.slice(nl + 1).replace(/\n$/, "") : "";
      html +=
        `<div class="asst-code" data-lang="${escHtml(lang)}"><div class="asst-code__head"><span>${escHtml(lang || "код")}</span>` +
        `<button type="button" data-code-copy>Копировать</button><button type="button" data-code-dl>Скачать</button></div>` +
        `<pre><code>${escHtml(code)}</code></pre></div>`;
    });
    return html;
  }

  function setBotText(textEl, raw) {
    textEl.dataset.raw = raw;
    textEl.innerHTML = renderMarkdown(raw);
  }

  // Кнопки блоков кода (делегирование: блоки появляются на лету при стриме)
  feedIn.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-code-copy], [data-code-dl]");
    if (!btn) return;
    const block = btn.closest(".asst-code");
    const code = block?.querySelector("code")?.textContent || "";
    if (btn.hasAttribute("data-code-copy")) {
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "Скопировано";
        setTimeout(() => (btn.textContent = "Копировать"), 1500);
      } catch {
        showToast("Не удалось скопировать");
      }
      return;
    }
    const ext = CODE_EXT[block.dataset.lang] || "txt";
    const href = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = `banana-code.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  });

  function addBotMessage(text = "") {
    hideEmpty();
    const row = el("div", "asst-msg asst-msg--bot");
    const ava = el("span", "asst-ava");
    ava.innerHTML = LOGO_SVG;
    const body = el("div", "asst-msg__body");
    const textEl = el("div", "asst-text asst-md");
    setBotText(textEl, text);
    body.appendChild(textEl);
    row.append(ava, body);
    feedIn.appendChild(row);
    return { row, body, textEl };
  }

  function addTyping() {
    const row = el("div", "asst-typing");
    row.append(el("span", "asst-typing__ava"), "Ассистент думает…");
    feedIn.appendChild(row);
    return row;
  }

  /** В ленте — превью 512px, по клику и в «Скачать» — оригинал. */
  function imageCard({ id, url, preview_url, prompt, model, aspect_ratio, expires_at }, { reveal = false } = {}) {
    // reveal — проявление после генерации: из размытия, маской кругом из центра
    const card = el("div", `asst-img${reveal ? " asst-img--reveal" : ""}`);
    const img = el("img", "asst-img__pic");
    img.src = preview_url || url;
    img.addEventListener("error", refreshLinksOnce);
    img.alt = prompt ? `Картинка: ${prompt.slice(0, 120)}` : "Сгенерированная картинка";
    img.loading = "lazy";
    img.addEventListener("click", () => {
      markViewed(id);
      if (typeof openResultModal === "function") openResultModal(url);
      else window.open(url, "_blank", "noopener");
    });
    img.addEventListener("load", () => scrollToBottom());

    const meta = el("div", "asst-img__meta");
    const tags = el("div", "asst-img__tags");
    tags.append(el("span", "asst-badge", "−1 генерация"));
    const info = [model, aspect_ratio].filter(Boolean).join(" · ");
    if (info) tags.append(el("span", "", info));
    meta.appendChild(tags);

    // Срок хранения: за сутки до удаления — предупреждаем
    const left = Date.parse(expires_at || "") - Date.now();
    if (Number.isFinite(left)) {
      const soon = left < 24 * 60 * 60 * 1000;
      meta.appendChild(
        el(
          "div",
          `asst-img__ttl${soon ? " is-soon" : ""}`,
          soon ? "Удалится завтра — скачай" : `Хранится ${IMAGE_TTL_DAYS} дней — скачай`
        )
      );
    }

    if (prompt) {
      const details = el("details");
      details.append(el("summary", "", "Промт"), el("p", "", prompt));
      meta.appendChild(details);
    }

    const actions = el("div", "asst-img__actions");
    actions.append(
      button("b b--g", "Скачать", () => {
        markViewed(id);
        void downloadImage(url);
      }),
      button("b b--g", "Ещё вариант", () => {
        if (sending || blocked) return;
        void send("Сделай ещё вариант этой картинки");
      })
    );
    meta.appendChild(actions);
    card.append(img, meta);
    return card;
  }

  /** Картинку удалили по сроку: текст и промт остались, можно сгенерировать заново. */
  function expiredImageCard({ id, prompt, aspect_ratio }) {
    const card = el("div", "asst-img asst-img--expired");
    const ph = el("div", "asst-img__wait");
    ph.append(
      el("strong", "", "Картинка удалена"),
      el("span", "", `Храним ${IMAGE_TTL_DAYS} дней. Промт остался — можно сделать заново.`)
    );
    const meta = el("div", "asst-img__meta");
    if (prompt) {
      const details = el("details");
      details.append(el("summary", "", "Промт"), el("p", "", prompt));
      meta.appendChild(details);
    }
    // Повтор по сохранённому промту напрямую, без модели: −1 генерация, лимит ассистента не тратит
    const again = button("b b--y b--full", "Сгенерировать снова", () => void regenerate(id, card, again, aspect_ratio));
    if (!prompt || !id) again.disabled = true;
    meta.appendChild(again);
    card.append(ph, meta);
    return card;
  }

  async function regenerate(id, card, btn, aspect_ratio) {
    if (sending || !id) return;
    sending = true;
    btn.disabled = true;
    const gen = genCard({ aspect_ratio });
    card.replaceWith(gen.el);
    const backToCard = () => {
      gen.el.replaceWith(card);
      btn.disabled = false;
    };
    try {
      const { ok, status, data } = await api(`/api/assistant/messages/${encodeURIComponent(id)}/regenerate`, {
        method: "POST",
        body: "{}",
      });
      if (data?.balance != null) setBalance(data.balance);
      if (ok) {
        gen.done(data.image);
      } else if (status === 402) {
        backToCard();
        card.after(noteCard("Не хватает генераций", "Картинка стоит 1 генерацию. Ничего не списано.", ["Пополнить", openPlans]));
      } else {
        gen.fail(undefined, backToCard);
      }
    } catch {
      gen.fail("Связь оборвалась — картинка могла успеть сгенерироваться. Обнови чат", () => conversationId && void openConversation(conversationId), "Обновить чат");
    } finally {
      sending = false;
      updateSendButton();
    }
  }

  /** Статистика: картинку открыли на весь экран или скачали. */
  function markViewed(id) {
    if (!id) return;
    void api(`/api/assistant/messages/${encodeURIComponent(id)}/viewed`, { method: "POST", body: "{}" }).catch(() => {});
  }

  // Подписанные ссылки живут час: картинка не открылась — один раз перезапрашиваем диалог
  let linksRefreshedAt = 0;
  function refreshLinksOnce() {
    if (!conversationId || sending || Date.now() - linksRefreshedAt < 60_000) return;
    linksRefreshedAt = Date.now();
    void openConversation(conversationId);
  }

  /* ---------- Анимация генерации ---------- */

  // Шаги по времени (средняя генерация 20–60 с). На последнем висим, пока не придёт картинка.
  const GEN_STEPS = [
    [0, "Собираю промт…"],
    [8, "Подбираю композицию…"],
    [20, "Рисую детали…"],
    [35, "Навожу резкость…"],
  ];

  /**
   * Карточка «идёт генерация»: точки, блик, шаг и секундомер. Модель отдаёт картинку
   * целиком в конце, поэтому вся анимация — на фронте.
   * Возвращает { el, done(image), fail(message, onRetry), restart(), isLoading() }.
   */
  // Какой кадр реально придёт: GPT Image умеет 1024×1024, 1024×1536 и 1536×1024
  const GEN_FRAME = { "1:1": "1 / 1", "3:4": "2 / 3", "9:16": "2 / 3", "4:3": "3 / 2", "16:9": "3 / 2" };

  function genCard({ aspect_ratio } = {}) {
    const wrap = el("div", "asst-gen");
    const card = el("div", "asst-img asst-gen__card");
    const stage = el("div", "asst-gen__stage");
    // Плейсхолдер — в пропорциях будущей картинки, чтобы лента не прыгала
    stage.style.aspectRatio = GEN_FRAME[aspect_ratio] || "1 / 1";
    const bar = el("div", "asst-gen__bar");
    const stepEl = el("span", "asst-gen__step");
    stepEl.setAttribute("aria-live", "polite");
    const secEl = el("span", "asst-gen__sec");
    bar.append(el("span", "asst-gen__dot"), stepEl, secEl);
    stage.append(el("div", "asst-gen__dots"), el("div", "asst-gen__sweep"), bar);
    card.appendChild(stage);
    const hint = el("div", "asst-gen__hint");
    wrap.append(card, hint);

    let timer = null;
    let loading = false;
    const stop = () => {
      window.clearInterval(timer);
      timer = null;
    };

    function start() {
      stop();
      loading = true;
      wrap.classList.remove("is-error");
      hint.textContent = ["Обычно 20–60 секунд", aspect_ratio].filter(Boolean).join(" · ");
      const startedAt = Date.now();
      let lastStep = "";
      const tick = () => {
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        secEl.textContent = `${sec} с`;
        const step = [...GEN_STEPS].reverse().find(([at]) => sec >= at)[1];
        if (step !== lastStep) {
          lastStep = step;
          stepEl.textContent = step;
          stepEl.classList.remove("is-new");
          void stepEl.offsetWidth; // перезапуск анимации появления шага
          stepEl.classList.add("is-new");
        }
      };
      tick();
      timer = window.setInterval(tick, 1000);
    }

    start();
    return {
      el: wrap,
      isLoading: () => loading,
      restart: start,
      /** Сначала грузим превью, потом проявляем — без белой вспышки. */
      done(image) {
        const finish = (reveal) => {
          stop();
          loading = false;
          const ready = imageCard(image, { reveal });
          wrap.replaceWith(ready);
          scrollToBottom(true);
        };
        const pre = new Image();
        pre.onload = () => finish(true);
        pre.onerror = () => finish(false);
        pre.src = image.preview_url || image.url;
      },
      fail(message, onRetry, retryLabel = "Попробовать снова") {
        stop();
        loading = false;
        wrap.classList.add("is-error");
        stepEl.textContent = message || "Не получилось сгенерировать, генерация не списана";
        secEl.textContent = "";
        hint.textContent = "";
        if (onRetry) hint.appendChild(button("b b--g b--s", retryLabel, onRetry));
      },
    };
  }

  /** «Попробовать снова»: тот же промт напрямую, без модели. Списание — только при успехе. */
  async function retryGeneration(gen, { prompt, aspect_ratio }, convId) {
    if (sending || !prompt || !convId) return;
    sending = true;
    updateSendButton();
    gen.restart();
    try {
      const { ok, status, data } = await api("/api/assistant/generate", {
        method: "POST",
        body: JSON.stringify({ conversation_id: convId, prompt, aspect_ratio }),
      });
      if (data?.balance != null) setBalance(data.balance);
      if (ok) {
        gen.done(data.image);
      } else if (status === 402) {
        gen.el.replaceWith(
          noteCard("Не хватает генераций", "Картинка стоит 1 генерацию. Ничего не списано.", ["Пополнить", openPlans])
        );
      } else {
        gen.fail(undefined, () => void retryGeneration(gen, { prompt, aspect_ratio }, convId));
      }
    } catch {
      // Обрыв связи: на сервере генерация могла пройти — не повторяем вслепую, иначе спишем дважды
      gen.fail("Связь оборвалась — картинка могла успеть сгенерироваться. Обнови чат", () => void openConversation(convId), "Обновить чат");
    } finally {
      sending = false;
      updateSendButton();
    }
  }

  async function downloadImage(url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `nano-banana-${Date.now()}.${(blob.type.split("/")[1] || "png").replace("jpeg", "jpg")}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 2000);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  }

  /* ---------- Диалоги ---------- */

  function setTitle(title) {
    titleEl.textContent = title || "Новый чат";
  }

  function renderChats() {
    chatsEl.textContent = "";
    if (!authed) return;
    if (!conversations.length) {
      chatsEl.appendChild(el("div", "asst-chats__empty", "Здесь появятся твои диалоги"));
      return;
    }
    conversations.forEach((c) => {
      const b = button(`asst-chat${String(c.id) === String(conversationId) ? " is-on" : ""}`, null, () => {
        closeDrawer();
        if (String(c.id) !== String(conversationId)) void openConversation(c.id);
      });
      b.append(el("span", "asst-chat__title", c.title || "Без названия"), el("span", "asst-chat__when", formatWhen(c.updated_at)));
      if (String(c.id) === String(conversationId)) b.setAttribute("aria-current", "true");

      const del = button("asst-chat__del", null, () => void deleteConversation(c));
      del.setAttribute("aria-label", `Удалить переписку «${c.title || "Без названия"}»`);
      del.title = "Удалить переписку";
      del.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12"/><path d="M9 7V4h6v3"/></svg>';

      const row = el("div", "asst-chat-row");
      row.append(b, del);
      chatsEl.appendChild(row);
    });
  }

  async function deleteConversation(c) {
    if (sending) return;
    if (!window.confirm(`Удалить переписку «${c.title || "Без названия"}»? Картинки из неё тоже удалятся.`)) return;
    const { ok, data } = await api(`/api/assistant/conversations/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (!ok) {
      showToast(data?.error || "Не удалось удалить переписку");
      return;
    }
    conversations = conversations.filter((x) => String(x.id) !== String(c.id));
    if (String(c.id) === String(conversationId)) newChat();
    else renderChats();
    showToast("Переписка удалена");
  }

  async function loadConversations() {
    const { ok, data } = await api("/api/assistant/conversations");
    if (ok) conversations = data.conversations || [];
    renderChats();
  }

  const loader = $("asst-loading");
  function setLoading(on) {
    loader.hidden = !on;
    feedIn.classList.toggle("is-loading", on);
  }

  async function openConversation(id) {
    if (sending) return false;
    // Сразу убираем прошлую переписку и показываем лоадер, а не старое/приветствие
    clearFeed(false);
    setLoading(true);
    let res;
    try {
      res = await api(`/api/assistant/conversations/${encodeURIComponent(id)}/messages`);
    } finally {
      setLoading(false);
    }
    const { ok, data } = res;
    if (!ok) {
      showToast(data?.error || "Не удалось открыть диалог");
      if (!conversationId) newChat();
      return false;
    }
    conversationId = data.conversation.id;
    syncUrl();
    setTitle(data.conversation.title);
    clearFeed(false);
    let lastBot = null;
    (data.messages || []).forEach((m) => {
      if (m.role === "user") {
        addUserMessage(m.content, m.images || [], m.images_expired || 0, m.files || []);
        lastBot = null;
      } else if (m.role === "assistant") {
        lastBot = addBotMessage(m.content);
      } else if (m.role === "image") {
        if (!lastBot) lastBot = addBotMessage("");
        lastBot.body.appendChild(m.expired ? expiredImageCard(m) : imageCard(m));
      }
    });
    renderChats();
    if (blocked) setBlocked(true, lastState);
    openedAt = Date.now();
    scrollToBottom(true);
  }

  // Открытый диалог — в адресе (?c=id): переживает перезагрузку и вход
  function syncUrl() {
    const url = new URL(window.location.href);
    if (conversationId) url.searchParams.set("c", String(conversationId));
    else url.searchParams.delete("c");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function newChat() {
    if (sending) return;
    conversationId = null;
    syncUrl();
    setTitle("Новый чат");
    clearFeed();
    renderChats();
    if (blocked) setBlocked(true, lastState);
    closeDrawer();
    input.focus();
  }

  /* ---------- Состояние ---------- */

  let lastState = null;

  async function loadState() {
    const { ok, status, data } = await api("/api/assistant/state");
    if (status === 401) {
      authed = false;
      renderGuestUsage();
      return;
    }
    if (!ok) return;
    lastState = data.state;
    setBalance(data.balance);
    setModelLabel(data.model_label);
    renderGreeting(data.username);
    if (Number(data.image_ttl_days) > 0) IMAGE_TTL_DAYS = Number(data.image_ttl_days);
    renderUsage(data.state);
  }

  /* ---------- Отправка ---------- */

  function updateSendButton() {
    sendBtn.disabled = blocked || sending || isUploading() || !input.value.trim();
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    // Полоса прокрутки — только когда текст правда не влезает (иначе на мобиле торчит серая палка)
    input.style.overflowY = input.scrollHeight > 160 ? "auto" : "hidden";
  }

  const isUploading = () => attachments.some((a) => a.uploading);

  const FILE_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>';
  const X_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} Б`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
    return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  }

  /** Карточка документа: иконка, имя, размер (в ленте и над полем ввода). */
  function fileChip(f, extraClass = "") {
    const chip = el("div", `asst-file${extraClass ? ` ${extraClass}` : ""}`);
    const ic = el("span", "asst-file__ic");
    ic.innerHTML = FILE_ICON;
    const info = el("span", "asst-file__info");
    info.append(el("span", "asst-file__name", f.name));
    const meta = [formatSize(f.size), f.truncated ? "прочитана часть" : ""].filter(Boolean).join(" · ");
    info.append(el("span", "asst-file__meta", meta));
    chip.append(ic, info);
    return chip;
  }

  function renderAttachments() {
    attachList.textContent = "";
    attachList.hidden = !attachments.length;
    attachments.forEach((a) => {
      const x = button("asst-attach-preview__x", null, () => removeAttachment(a.id));
      x.innerHTML = X_ICON;
      let item;
      if (a.type === "file") {
        item = fileChip(a, `asst-attach-file${a.uploading ? " is-loading" : ""}`);
        x.setAttribute("aria-label", `Убрать файл ${a.name}`);
      } else {
        item = el("div", `asst-attach-preview${a.uploading ? " is-loading" : ""}`);
        const img = el("img");
        img.src = a.preview;
        img.alt = "Прикреплённое фото";
        item.appendChild(img);
        x.setAttribute("aria-label", "Убрать фото");
      }
      item.appendChild(x);
      attachList.appendChild(item);
    });
    updateSendButton();
  }

  function removeAttachment(id) {
    const a = attachments.find((x) => x.id === id);
    if (a?.preview) URL.revokeObjectURL(a.preview);
    attachments = attachments.filter((x) => x.id !== id);
    renderAttachments();
  }

  function resetAttach(revoke = true) {
    if (revoke) attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    attachments = [];
    fileInput.value = "";
    renderAttachments();
  }

  /** Фото, документы и код разом (скрепка, вставка, перетаскивание). Лишнее сверх лимита — отбрасываем. */
  function onFilesPicked(picked) {
    const all = Array.from(picked || []).filter(Boolean);
    fileInput.value = "";
    if (!all.length) return;
    if (!authed) {
      openAuthModal();
      return;
    }
    const photos = all.filter(isPhoto);
    const docs = all.filter((f) => !isPhoto(f) && isReadableFile(f));
    if (photos.length + docs.length < all.length) showToast(UNSUPPORTED_HINT);

    const freePhotos = MAX_IMAGES - attachments.filter((a) => a.type !== "file").length;
    if (photos.length > freePhotos) showToast(`Не больше ${MAX_IMAGES} фото — лишние не добавил`);
    photos.slice(0, Math.max(0, freePhotos)).forEach((file) => void uploadAttachment(file));

    const freeDocs = MAX_FILES - attachments.filter((a) => a.type === "file").length;
    if (docs.length > freeDocs) showToast(`Не больше ${MAX_FILES} файлов — лишние не добавил`);
    docs.slice(0, Math.max(0, freeDocs)).forEach((file) => void uploadDocument(file));
  }

  async function uploadAttachment(file) {
    if (file.size > 10 * 1024 * 1024) {
      showToast("Фото больше 10 МБ");
      return;
    }
    const a = { id: ++attachSeq, type: "image", path: "", preview: URL.createObjectURL(file), uploading: true };
    attachments.push(a);
    renderAttachments();
    try {
      const image = await fileToJpegBase64(file);
      const { ok, data } = await api("/api/assistant/upload", {
        method: "POST",
        body: JSON.stringify(image),
      });
      if (!ok || !data.path) throw new Error(data?.error || "Не удалось загрузить фото");
      a.path = data.path;
      a.uploading = false;
      renderAttachments();
    } catch (error) {
      showToast(error?.message || "Не удалось загрузить фото");
      removeAttachment(a.id);
    }
  }

  const readAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
      reader.readAsDataURL(file);
    });

  /** Документ / код: бэк достаёт текст, модель получит его в сообщении. */
  async function uploadDocument(file) {
    if (file.size > 10 * 1024 * 1024) {
      showToast("Файл больше 10 МБ");
      return;
    }
    const a = { id: ++attachSeq, type: "file", path: "", name: file.name, size: file.size, uploading: true };
    attachments.push(a);
    renderAttachments();
    try {
      const data64 = await readAsBase64(file);
      const { ok, data } = await api("/api/assistant/upload-file", {
        method: "POST",
        body: JSON.stringify({ name: file.name, data: data64 }),
      });
      if (!ok || !data.file?.path) throw new Error(data?.error || "Не удалось загрузить файл");
      Object.assign(a, data.file, { uploading: false });
      renderAttachments();
    } catch (error) {
      showToast(error?.message || "Не удалось загрузить файл");
      removeAttachment(a.id);
    }
  }

  async function send(text) {
    const message = String(text || "").trim();
    if (!message || sending || isUploading()) return;
    if (!authed) {
      openAuthModal();
      return;
    }
    if (blocked) {
      setBlocked(true, lastState);
      return;
    }
    if (message.length > MAX_CHARS) {
      showToast(`Сообщение длиннее ${MAX_CHARS} символов`);
      return;
    }

    const ready = attachments.filter((a) => a.path);
    const readyPhotos = ready.filter((a) => a.type !== "file");
    const readyFiles = ready.filter((a) => a.type === "file");
    const imagePaths = readyPhotos.map((a) => a.path);
    const filePaths = readyFiles.map((a) => a.path);
    // Локальные превью остаются в ленте — не освобождаем их при очистке
    const localPhotos = readyPhotos.map((a) => ({ url: a.preview }));
    sending = true;
    input.value = "";
    autoGrow();
    resetAttach(false);
    updateSendButton();
    feedIn.querySelectorAll(".asst-note--err").forEach((n) => n.remove());

    addUserMessage(message, localPhotos, 0, readyFiles);
    const typing = addTyping();
    scrollToBottom(true);

    let bot = null;
    const ensureBot = () => {
      if (!bot) {
        typing.remove();
        bot = addBotMessage("");
      }
      return bot;
    };

    try {
      const headers = authHeaders(false);
      headers.set("Content-Type", "application/json");
      const response = await fetch(`${apiBase()}/api/assistant/chat`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ conversation_id: conversationId, message, image_paths: imagePaths, file_paths: filePaths }),
      });

      const isStream = (response.headers.get("content-type") || "").includes("text/event-stream");
      if (!response.ok || !isStream) {
        typing.remove();
        let data = {};
        try {
          data = await response.json();
        } catch {
          data = {};
        }
        handleRequestError(response.status, data);
        return;
      }

      await readStream(response, {
        meta(data) {
          const isNew = !conversationId;
          conversationId = data.conversation_id;
          syncUrl();
          setTitle(data.title);
          if (isNew) {
            conversations.unshift({ id: data.conversation_id, title: data.title, updated_at: new Date().toISOString() });
            renderChats();
          }
        },
        delta(data) {
          const b = ensureBot();
          setBotText(b.textEl, (b.textEl.dataset.raw || "") + (data.text || ""));
          scrollToBottom();
        },
        tool_start(data) {
          const b = ensureBot();
          b.gen = genCard(data);
          b.genArgs = { prompt: data.prompt, aspect_ratio: data.aspect_ratio };
          b.body.appendChild(b.gen.el);
          scrollToBottom(true);
        },
        image(data) {
          const b = ensureBot();
          if (b.gen) b.gen.done(data);
          else b.body.appendChild(imageCard(data, { reveal: true }));
          b.gen = null;
          setBalance(data.balance);
          scrollToBottom(true);
        },
        tool_error(data) {
          const b = ensureBot();
          if (data.balance != null) setBalance(data.balance);
          if (data.code === "insufficient_balance") {
            b.gen?.el.remove();
            b.body.appendChild(
              noteCard("Не хватает генераций", "Картинка стоит 1 генерацию. Ничего не списано.", ["Пополнить", openPlans])
            );
          } else if (b.gen) {
            const gen = b.gen;
            const args = b.genArgs;
            const convId = conversationId;
            gen.fail(undefined, () => void retryGeneration(gen, args, convId));
          }
          b.gen = null;
          scrollToBottom(true);
        },
        error(data) {
          typing.remove();
          feedIn.appendChild(noteCard("Что-то пошло не так", data.message || "Попробуй ещё раз", null, true));
          scrollToBottom(true);
        },
        done(data) {
          typing.remove();
          // Стрим кончился, а картинки так и нет — показываем ошибку на карточке
          if (bot?.gen?.isLoading()) {
            const gen = bot.gen;
            const args = bot.genArgs;
            const convId = data.conversation_id;
            gen.fail(undefined, () => void retryGeneration(gen, args, convId));
            bot.gen = null;
          }
          if (bot && !(bot.textEl.dataset.raw || "").trim() && !bot.body.querySelector(".asst-img, .asst-note")) bot.row.remove();
          setBalance(data.balance);
          lastState = data.state;
          renderUsage(data.state);
          const c = conversations.find((x) => String(x.id) === String(data.conversation_id));
          if (c) {
            c.updated_at = new Date().toISOString();
            conversations = [c, ...conversations.filter((x) => x !== c)];
            renderChats();
          }
        },
      });
      typing.remove();
    } catch (error) {
      typing.remove();
      if (bot?.gen?.isLoading()) {
        const gen = bot.gen;
        const convId = conversationId;
        if (convId) gen.fail("Связь оборвалась — картинка могла успеть сгенерироваться. Обнови чат", () => void openConversation(convId), "Обновить чат");
        else gen.fail("Связь оборвалась — картинка могла успеть сгенерироваться. Обнови чат");
      }
      console.error("assistant send error", error);
      feedIn.appendChild(noteCard("Нет связи с сервером", "Проверь интернет и попробуй ещё раз.", null, true));
    } finally {
      sending = false;
      updateSendButton();
      if (!blocked) input.focus({ preventScroll: true });
    }
  }

  function handleRequestError(status, data) {
    if (status === 401) {
      authed = false;
      renderGuestUsage();
      openAuthModal();
      return;
    }
    if (data?.code === "LIMIT_REACHED") {
      lastState = data.state;
      renderUsage(data.state);
      return;
    }
    if (data?.code === "ASSISTANT_UNAVAILABLE") {
      feedIn.appendChild(noteCard("Ассистент временно недоступен", data.error, null, true));
      scrollToBottom(true);
      return;
    }
    if (status === 429) {
      showToast(data?.error || "Слишком часто, подожди пару секунд");
      return;
    }
    feedIn.appendChild(noteCard("Не получилось отправить", data?.error || "Попробуй ещё раз", null, true));
    scrollToBottom(true);
  }

  /** Разбор SSE из fetch: события «event: x / data: {...}», разделённые пустой строкой. */
  async function readStream(response, handlers) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const dispatch = (block) => {
      let event = "message";
      let data = "";
      block.split("\n").forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      });
      if (!data || !handlers[event]) return;
      try {
        handlers[event](JSON.parse(data));
      } catch (error) {
        console.error("assistant stream event error", event, error);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        dispatch(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
    if (buffer.trim()) dispatch(buffer);
  }

  /* ---------- События ---------- */

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void send(input.value);
  });

  input.addEventListener("input", () => {
    autoGrow();
    updateSendButton();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void send(input.value);
  });

  root.querySelectorAll("[data-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (blocked) return;
      input.value = chip.getAttribute("data-chip") || "";
      autoGrow();
      updateSendButton();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  $("asst-attach").addEventListener("click", () => {
    if (!authed) {
      openAuthModal();
      return;
    }
    fileInput.click();
  });
  fileInput.addEventListener("change", () => onFilesPicked(fileInput.files));

  // Фото из буфера: скопировал картинку → Cmd/Ctrl+V в поле ввода
  input.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter(Boolean);
    if (!files.length || blocked) return;
    event.preventDefault();
    onFilesPicked(files);
  });

  // Перетаскивание файла в чат
  const dropZone = root.querySelector(".asst-main");
  let dragDepth = 0;
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  dropZone.addEventListener("dragenter", (event) => {
    if (!hasFiles(event) || blocked) return;
    event.preventDefault();
    dragDepth += 1;
    dropZone.classList.add("is-drag");
  });
  dropZone.addEventListener("dragover", (event) => {
    if (hasFiles(event) && !blocked) event.preventDefault();
  });
  dropZone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.classList.remove("is-drag");
  });
  dropZone.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("is-drag");
    if (blocked) return;
    onFilesPicked(event.dataTransfer.files);
  });

  $("asst-new").addEventListener("click", newChat);
  root.querySelectorAll("[data-asst-topup]").forEach((b) => b.addEventListener("click", () => {
    if (!authed) openAuthModal();
    else openPlans();
  }));
  root.querySelector("[data-asst-open]")?.addEventListener("click", openDrawer);
  root.querySelectorAll("[data-asst-close]").forEach((b) => b.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  /* ---------- Старт ---------- */

  async function init() {
    mountSiteNav();
    // Короткая подсказка в поле на узком экране (и при повороте/ресайзе)
    const narrow = window.matchMedia("(max-width: 960px)");
    const desktopPlaceholder = input.placeholder;
    const syncPlaceholder = () => {
      input.placeholder = narrow.matches ? "Спроси что угодно" : desktopPlaceholder;
    };
    syncPlaceholder();
    narrow.addEventListener?.("change", syncPlaceholder);
    renderChats();
    const fromUrl = new URLSearchParams(window.location.search).get("c");
    setLoading(true);
    try {
      const auth = await fetchAuthMeCached({ maxAgeMs: 0 });
      authed = Boolean(auth);
      if (!authed) {
        renderGuestUsage();
        renderGreeting("");
      } else {
        setBalance(auth.balance);
        renderGreeting(usernameFromAuth(auth));
        await Promise.all([loadState(), loadConversations()]);
      }
    } finally {
      setLoading(false);
    }
    // SEO-блок «О помощнике»: гостю открыт под чатом, вошедшему — свёрнут под кнопкой
    const about = $("asst-about");
    if (about) {
      about.open = !authed;
      about.classList.toggle("is-guest", !authed);
    }

    // Ссылка на диалог — открываем его, иначе новый чат с приветствием
    if (authed && fromUrl) {
      const opened = await openConversation(fromUrl);
      if (opened !== false) return;
    }
    setTitle("Новый чат");
    clearFeed(true);
  }

  const usernameFromAuth = (auth) =>
    String(auth?.user?.display_name || auth?.user?.first_name || auth?.user?.username || "")
      .trim()
      .replace(/^@+/, "");

  void init();
})();
