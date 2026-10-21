#!/usr/bin/env node
// Собирает статичные страницы сайта из шаблонов в src/.
//
//   node scripts/build-site.mjs
//
// Что делает:
//   src/layout.html + src/pages/<page>.html → <path>/index.html
//   карточки /promty/ — из src/data/edit-prompts.json (прямо в разметку, для SEO)
//   sitemap.xml — все страницы из src/pages
//
// Сеть не нужна. Готовые файлы в корне правками не трогать — перезапишутся,
// правь шаблоны в src/ и запускай сборку заново.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://nanobananaa.ru";
// Промты для обработки своего фото: текст с [местами для замены], без картинок
const EDIT_PROMPTS_JSON = join(ROOT, "src/data/edit-prompts.json");
// Тарифы — одно место для карточек на главной, FAQ, JSON-LD и SEO-текста /assistant/
const TARIFFS_JSON = join(ROOT, "src/data/tariffs.json");

const today = new Date().toISOString().slice(0, 10);
const version = today.replace(/-/g, "");

const read = (p) => readFileSync(join(ROOT, p), "utf8");

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const stripTags = (html) =>
  String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const fill = (tpl, vars) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? vars[key] : m));

/* ---------- Иконки ---------- */

const svg = (paths, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICON = {
  photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3"/>',
  eraser: '<path d="M20 20H9L4 15a2 2 0 010-3l8-8a2 2 0 013 0l5 5a2 2 0 010 3l-7 7"/><path d="M9 8l7 7"/>',
  lines: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/>',
  // Палитра с красками (lucide, ISC) — иконка раздела «Промты»
  palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 011.67-1.67h2C19.49 16.38 22 13.87 22 10.82 21.97 6.01 17.46 2 12 2z"/><circle cx="13.5" cy="6.5" r="1" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  shirt: '<path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 01-8 0z"/>',
  wand: '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2L19 5"/><path d="M11 6.2L9.7 5"/><path d="M3 21l9-9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/>',
  crop: '<path d="M6 2v14a2 2 0 002 2h14"/><path d="M18 22V8a2 2 0 00-2-2H2"/>',
  pics: '<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M16 21H5a2 2 0 01-2-2V8"/>',
  // Скан: уголки рамки + 2 строки текста — «Промт по фото»
  scan: '<path d="M4 8V6a2 2 0 012-2h2"/><path d="M16 4h2a2 2 0 012 2v2"/><path d="M20 16v2a2 2 0 01-2 2h-2"/><path d="M8 20H6a2 2 0 01-2-2v-2"/><path d="M8 10h8"/><path d="M8 14h5"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  chat: '<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/><path d="M8.5 11h.01"/><path d="M12 11h.01"/><path d="M15.5 11h.01"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5"/><path d="M12 17h.01"/>',
  tg: '<path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l12-9"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
};

// Переключатель темы: луна (сейчас тёмная) / солнце (сейчас светлая)
const THEME_BTN = `      <button class="ico theme-btn" type="button" data-theme-toggle aria-label="Сменить тему: светлая или тёмная" title="Светлая / тёмная тема">${svg(
  '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
).replace("<svg ", '<svg class="theme-btn__moon" ')}${svg(
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/>'
).replace("<svg ", '<svg class="theme-btn__sun" ')}</button>`;

const LOGO_SVG =
  '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#F2C94C"/><path d="M8 16c4 4 10 3 12-5" stroke="#1a1406" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';

/* ---------- Навигация ---------- */

const TOOLS = [
  // «Чат GPT» (ассистент) — первым и с жёлтой рамкой (hl), но активной на главной остаётся «Генерация фото»
  { key: "assistant", href: "/assistant/", label: "Чат GPT", icon: "chat", tag: "beta", hl: true },
  { key: "photo", href: "/", label: "Генерация фото", icon: "photo" },
  { key: "video", href: "/ozhivit-foto/", label: "Оживить фото", icon: "video", tag: "видео" },
  // Убрать фон — отложен: шаблон в src/pages-off/ubrat-fon.html. Вернуть — перенести его
  // в src/pages/, раскомментировать строку ниже и пересобрать.
  // { key: "bg", href: "/ubrat-fon/", label: "Убрать фон", icon: "eraser", tag: "AI" },
  { key: "describe", href: "/promt-po-foto/", label: "Промт по фото", icon: "scan", tag: "new" },
  { key: "prompts", href: "/promty/", label: "Промты", icon: "palette" },
];

// collapsed — сайдбар свёрнут в полосу иконок (страница ассистента):
// подпись уходит в title, бейдж становится точкой (это делает CSS)
function sidebarNav(active, collapsed = false) {
  const item = ({ key, href, label, icon, tag, hl }) => {
    const on = key === active;
    return `            <a class="nav__item${on ? " is-on" : ""}${hl ? " nav__item--hl" : ""}" href="${href}"${
      on ? ' aria-current="page"' : ""
    }${collapsed ? ` title="${label}"` : ""}>${svg(ICON[icon])}<span class="nav__text">${label}${
      tag ? `<span class="nav__tag">${tag}</span>` : ""
    }</span></a>`;
  };
  return [
    '            <div class="nav__label">Инструменты</div>',
    ...TOOLS.map(item),
    '            <div class="nav__label">Сервис</div>',
    item({ key: "-", href: "/#pricing", label: "Тарифы", icon: "tag" }),
    item({ key: "-", href: "/#reviews", label: "Отзывы", icon: "star" }),
    item({ key: "-", href: "#faq", label: "Вопросы", icon: "help" }),
    item({ key: "rules", href: "/pravila/", label: "Правила", icon: "shield" }),
  ].join("\n");
}

function mobileNav(active) {
  return TOOLS.map(({ key, href, label, icon, hl }) => {
    const on = key === active;
    const cls = [on ? "is-on" : "", hl ? "is-hl" : ""].filter(Boolean).join(" ");
    return `      <a href="${href}"${cls ? ` class="${cls}"` : ""}${on ? ' aria-current="page"' : ""}>${svg(
      ICON[icon],
      16
    )}${label}</a>`;
  }).join("\n");
}

/* ---------- FAQ и хлебные крошки: разметка + JSON-LD из одних данных ---------- */

function faqHtml(items) {
  const rows = items
    .map(
      ([q, a], i) => `              <div class="faq-item${i === 0 ? " is-open" : ""}">
                <button type="button" class="faq-item__trigger" aria-expanded="${i === 0}">
                  <span>${q}</span>
                  <span class="faq-item__icon" aria-hidden="true">+</span>
                </button>
                <div class="faq-item__panel">
                  <div class="faq-item__content"><p>${a}</p></div>
                </div>
              </div>`
    )
    .join("\n");
  return `          <section id="faq" class="sec" aria-labelledby="faq-title">
            <h2 id="faq-title" class="h2">Частые вопросы</h2>
            <div class="faq-list" data-faq-accordion>
${rows}
            </div>
          </section>`;
}

function crumbsHtml(crumbs) {
  const items = crumbs
    .map(([name, url], i) =>
      i === crumbs.length - 1
        ? `<li aria-current="page">${name}</li>`
        : `<li><a href="${url}">${name}</a></li>`
    )
    .join("");
  return `<nav aria-label="Хлебные крошки"><ol class="crumbs">${items}</ol></nav>`;
}

function jsonLd(meta, canonical) {
  const graph = [...(meta.jsonld || [])];
  if (meta.crumbs?.length) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: meta.crumbs.map(([name, url], i) => ({
        "@type": "ListItem",
        position: i + 1,
        name,
        item: i === meta.crumbs.length - 1 ? canonical : SITE + url,
      })),
    });
  }
  if (meta.faq?.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${canonical}#faq`,
      mainEntity: meta.faq.map(([q, a]) => ({
        "@type": "Question",
        name: stripTags(q),
        acceptedAnswer: { "@type": "Answer", text: stripTags(a) },
      })),
    });
  }
  if (!graph.length) return "";
  const body = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)
    .split("\n")
    .map((l) => "      " + l)
    .join("\n");
  return `    <script type="application/ld+json">\n${body}\n    </script>`;
}

/* ---------- Промты для обработки своего фото ---------- */

const EDIT_CAT_ICON = {
  fon: "photo",
  portret: "user",
  obraz: "shirt",
  udalit: "wand",
  svet: "sun",
  kadr: "crop",
};

function loadEditPrompts() {
  const data = JSON.parse(readFileSync(EDIT_PROMPTS_JSON, "utf8"));
  const cats = data.categories.map((c) => ({
    ...c,
    icon: EDIT_CAT_ICON[c.id] || "wand",
    count: data.prompts.filter((p) => p.category === c.id).length,
  }));
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const prompts = data.prompts.map((p) => ({ ...p, cat: catById[p.category] }));
  return { cats, prompts };
}

/** [место для замены] → жёлтая подсветка */
const markSlots = (text) => esc(text).replace(/\[([^\]]+)\]/g, "<mark>[$1]</mark>");

function editTabs({ cats, prompts }) {
  const tab = (id, label, icon, count, on) =>
    `              <button class="etab${on ? " is-on" : ""}" type="button" data-ecat="${id}" aria-pressed="${on}">${
      icon ? svg(ICON[icon], 16) : ""
    }<span>${esc(label)}</span><span class="etab__n">${count}</span></button>`;
  return [
    tab("", "Все", "", prompts.length, true),
    ...cats.map((c) => tab(c.id, c.name, c.icon, c.count, false)),
  ].join("\n");
}

function editCards({ prompts }) {
  return prompts
    .map(
      (p) => `              <article class="card ecard" data-slug="${esc(p.slug)}" data-ecat="${esc(p.category)}" data-en="${esc(p.prompt_en)}" data-ru="${esc(p.prompt_ru)}" data-images="${p.images}">
                <div class="ecard__head">
                  <span class="ecard__ic">${svg(ICON[p.cat.icon])}</span>
                  <span class="ecard__cat">${esc(p.cat.name)}</span>
                  ${p.images > 1 ? `<span class="ebadge" title="Нужно загрузить ${p.images} фото">${svg(ICON.pics, 14)}${p.images} фото</span>` : ""}
                </div>
                <h3 class="ecard__title"><button type="button" data-eopen>${esc(p.title)}</button></h3>
                <p class="ecard__desc">${esc(p.description)}</p>
                <button class="ecard__prompt" type="button" data-eopen aria-label="Открыть промт «${esc(p.title)}»"><span>${markSlots(p.prompt_ru)}</span></button>
                <div class="pcard__actions">
                  <button class="b b--y b--s" type="button" data-etry>Попробовать</button>
                  <button class="ico ico--s" type="button" data-ecopy aria-label="Скопировать промт" title="Скопировать">${svg(ICON.copy)}</button>
                </div>
              </article>`
    )
    .join("\n");
}

/* ---------- Тарифы ---------- */

const rub = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const perGen = (p) => (p.price / p.generations).toFixed(1).replace(".", ",");

function tariffCards({ plans, tier_days, window_hours, trial_requests }) {
  return plans
    .map((p) => {
      // hot — «Выбор большинства», shine — обычная карточка с жёлтой рамкой и бликом
      const cls = p.style === "hot" ? " tariff--hot" : p.style === "shine" ? " tariff--shine" : "";
      const btn = p.style === "hot" ? "b--y" : "b--g";
      const ai = p.assistant_requests
        ? `<span><strong>ИИ-ассистент</strong> на ${tier_days} дней</span><span class="tariff__note">~${p.assistant_requests} запросов каждые ${window_hours} часов</span>`
        : `<span><strong>ИИ-ассистент</strong> — пробный</span><span class="tariff__note">~${trial_requests} запросов разово</span>`;
      return `              <article class="card tariff${cls}">
                <div class="tariff__head">
                  <div class="tariff__row">
                    <h3 class="tariff__name">${esc(p.name)}</h3>
                    ${p.flag ? `<span class="tariff__flag">${esc(p.flag)}</span>` : ""}
                  </div>
                  ${p.discount ? `<span class="tariff__disc">${esc(p.discount)}</span>` : `<span class="tariff__sub">${esc(p.sub || "")}</span>`}
                </div>
                <div class="tariff__price">
                  <span class="tariff__sum">${rub(p.price)} ₽</span>
                  <span class="tariff__per">${perGen(p)} ₽ за генерацию</span>
                </div>
                <ul class="tariff__list">
                  <li><span class="tariff__ic">${svg(ICON.photo)}</span><span><strong>${p.generations}</strong> генераций фото</span></li>
                  <li><span class="tariff__ic">${svg(ICON.sparkle)}</span><span class="tariff__ai">${ai}</span></li>
                </ul>
                <button type="button" class="b b--lg ${btn}" data-plan-price="${p.price}">Выбрать</button>
              </article>`;
    })
    .join("\n");
}

function loadTariffVars() {
  const t = JSON.parse(readFileSync(TARIFFS_JSON, "utf8"));
  const prices = t.plans.map((p) => p.price);
  const withAssistant = t.plans.filter((p) => p.assistant_requests);
  const gens = t.plans.slice(1).map((p) => p.generations);
  return {
    tariff_cards: tariffCards(t),
    price_min: String(Math.min(...prices)),
    price_max: String(Math.max(...prices)),
    // «пакеты от 499 ₽» — самый дешёвый пакет, который открывает ассистента
    price_from: String(Math.min(...withAssistant.map((p) => p.price))),
    price_from_name: withAssistant.sort((a, b) => a.price - b.price)[0].name,
    plans_count: String(t.plans.length),
    gens_list: `${gens.slice(0, -1).join(", ")} и ${gens[gens.length - 1]}`,
    trial_requests: String(t.trial_requests),
    tier_days: String(t.tier_days),
    window_hours: String(t.window_hours),
  };
}

/* ---------- Сборка ---------- */

function parsePage(file) {
  // Цифры тарифов подставляем до разбора meta: они нужны и в FAQ/JSON-LD, и в тексте
  const raw = fill(read(`src/pages/${file}`), tariffVars);
  const metaMatch = raw.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
  if (!metaMatch) throw new Error(`${file}: нет блока <!--meta {...} -->`);
  const meta = JSON.parse(metaMatch[1]);
  let rest = raw.slice(metaMatch[0].length);
  let head = "";
  rest = rest.replace(/<!--head-->([\s\S]*?)<!--\/head-->\s*/, (_, h) => {
    head = h.replace(/\s+$/, "");
    return "";
  });
  return { meta, head, content: rest.replace(/\s+$/, "") };
}

const layout = read("src/layout.html");
const partials = {
  modals: read("src/partials/modals.html").replace(/\s+$/, ""),
  result_panel: read("src/partials/result-panel.html").replace(/\s+$/, ""),
};

const editPrompts = loadEditPrompts();
const tariffVars = loadTariffVars();
const pageFiles = readdirSync(join(ROOT, "src/pages")).filter((f) => f.endsWith(".html"));
const built = [];

for (const file of pageFiles) {
  const { meta, head, content } = parsePage(file);
  const canonical = SITE + meta.path;

  const contentVars = {
    ...partials,
    crumbs: meta.crumbs ? crumbsHtml(meta.crumbs) : "",
    faq: meta.faq ? faqHtml(meta.faq) : "",
    edit_tabs: editTabs(editPrompts),
    edit_cards: editCards(editPrompts),
    edit_count: String(editPrompts.prompts.length),
    ...Object.fromEntries(Object.entries(ICON).map(([k, v]) => [`i_${k}`, svg(v)])),
  };

  const html = fill(layout, {
    title: esc(meta.title),
    og_title: esc(meta.og_title || meta.title),
    description: esc(meta.description),
    og_description: esc(meta.og_description || meta.description),
    canonical,
    og_image: meta.og_image || `${SITE}/assets/images/nano-banana3.webp`,
    version,
    gen: meta.gen || "",
    body_class: meta.body_class || "",
    sb_class: meta.sidebar === "collapsed" ? " collapsed" : "",
    // "noindex, follow" — страница работает по ссылке, но не индексируется
    robots: meta.robots || "index, follow",
    head: fill([head, jsonLd(meta, canonical)].filter(Boolean).join("\n"), { version }),
    content: fill(content, contentVars),
    modals: partials.modals,
    scripts: (meta.scripts || [])
      .map((s) => `    <script src="${s}?v=${version}"></script>`)
      .join("\n"),
    sidebar_nav: sidebarNav(meta.nav, meta.sidebar === "collapsed"),
    mobile_nav: mobileNav(meta.nav),
    logo_svg: LOGO_SVG,
    menu_svg: svg(ICON.menu),
    theme_btn: THEME_BTN,
    tg_svg: svg(ICON.tg),
  });

  const leftover = html.match(/\{\{\w+\}\}/g);
  if (leftover) throw new Error(`${file}: не заполнены ${[...new Set(leftover)].join(", ")}`);

  const outDir = join(ROOT, meta.path);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.html"), html);
  built.push(meta);
  console.log(`✓ ${meta.path}index.html`);
}

/* ---------- sitemap.xml ---------- */

// В sitemap — только индексируемые страницы
const urls = built
  .filter((m) => !String(m.robots || "").includes("noindex"))
  .sort((a, b) => (b.priority || 0.5) - (a.priority || 0.5))
  .map(
    (m) => `  <url>
    <loc>${SITE}${m.path}</loc>
    <lastmod>${today}</lastmod>
    <priority>${(m.priority || 0.8).toFixed(1)}</priority>
  </url>`
  )
  .join("\n");

writeFileSync(
  join(ROOT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
);
console.log(`✓ sitemap.xml (${built.length} стр.)`);
