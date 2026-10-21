import { v2 as cloudinary } from "cloudinary";
import XLSX from "xlsx";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function main() {
  console.log("🔄 Читаем Excel...");
  const workbook = XLSX.readFile("prompts.xlsx");
  const sheetName = workbook.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  let success = 0,
    errors = 0;

  for (const row of data) {
    if (!row.url || !row.url.includes("pbs.twimg.com/media")) continue;

    try {
      console.log(
        `📤 Загружаем ${row.ID || "N/A"}: ${row.url.substring(0, 50)}...`
      );

      const res = await cloudinary.uploader.upload(row.url, {
        folder: "PROMPTS",
        overwrite: true,
        resource_type: "image",
      });

      // Заменяем URL на CDN
      row.url = res.secure_url;
      success++;
      console.log(`✅ Готово: ${res.public_id}`);
    } catch (e) {
      console.error(`❌ ${row.ID || "N/A"}: ${e.message}`);
      errors++;
    }
  }

  // Сохраняем обновлённый Excel + JSON для сервера
  const newWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    newWb,
    XLSX.utils.json_to_sheet(data),
    "PROMPTS"
  );
  XLSX.writeFile(newWb, "prompts.xlsx");

  // JSON для твоего сервера
  fs.writeFileSync("prompts.json", JSON.stringify(data, null, 2));

  console.log(`\n🎉 ГОТОВО!`);
  console.log(`✅ Успешно: ${success}`);
  console.log(`❌ Ошибок: ${errors}`);
  console.log(`📁 Excel: NANO-Banana-PROMPTS.xlsx`);
  console.log(`📄 JSON: prompts.json`); // ← раздавай это на сервере!
}

main().catch(console.error);
