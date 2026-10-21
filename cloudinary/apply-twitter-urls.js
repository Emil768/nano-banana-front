/**
 * Подставляет в prompts.xlsx / prompts.json колонку url из twitter-urls.txt
 * (строка 1 → ID 1, строка 2 → ID 2, …). Запуск из каталога cloudinary/.
 */
import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const listFile = process.argv[2] || "twitter-urls.txt";

const raw = fs.readFileSync(listFile, "utf8");
const urls = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith("https://pbs.twimg.com/media/"));

if (urls.length === 0) {
  console.error(`Нет URL в ${listFile}`);
  process.exit(1);
}

const workbook = XLSX.readFile("prompts.xlsx");
const sheetName = workbook.SheetNames[0];
const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

const sorted = [...data].sort(
  (a, b) => Number(a.ID ?? 0) - Number(b.ID ?? 0)
);

if (sorted.length !== urls.length) {
  console.warn(
    `⚠️  строк в Excel: ${sorted.length}, URL в файле: ${urls.length} — подставляем min(...) по порядку ID`
  );
}

const n = Math.min(sorted.length, urls.length);
for (let i = 0; i < n; i++) {
  sorted[i].url = urls[i];
}

const byId = new Map(sorted.map((r) => [Number(r.ID), r]));
for (let j = 0; j < data.length; j++) {
  const id = Number(data[j].ID);
  const row = byId.get(id);
  if (row) data[j].url = row.url;
}

const newWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newWb, XLSX.utils.json_to_sheet(data), "PROMPTS");
XLSX.writeFile(newWb, "prompts.xlsx");
fs.writeFileSync("prompts.json", JSON.stringify(data, null, 2));

console.log(`✅ Подставлено ${n} Twitter-URL в prompts.xlsx и prompts.json`);
if (urls.length !== sorted.length) {
  console.log(`   (в списке ${urls.length} ссылок, в таблице ${sorted.length} строк)`);
}
