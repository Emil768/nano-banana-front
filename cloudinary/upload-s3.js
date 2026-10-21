import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import XLSX from "xlsx";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

/** Не секреты: Beget Object Storage ru1. Переопределите через .env при другом бакете. */
const DEFAULT_S3_ENDPOINT = "https://s3.ru1.storage.beget.cloud";
const DEFAULT_S3_BUCKET = "97b4b1367e3f-guiding-ilona";

const bucket = process.env.S3_BUCKET || DEFAULT_S3_BUCKET;
const endpoint = (process.env.S3_ENDPOINT || DEFAULT_S3_ENDPOINT).replace(
  /\/$/,
  ""
);
const region = process.env.S3_REGION || "ru-1";
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const keyPrefix = (process.env.S3_KEY_PREFIX || "prompts").replace(
  /^\/+|\/+$/g,
  ""
);
const forcePathStyle =
  String(process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true";

/** Только если задано в .env: папка с файлами {ID}.jpg для заливки без HTTP */
const sourceDirEnv = (process.env.S3_SOURCE_DIR || "").trim();

const rehostAnyHttps =
  String(process.env.S3_REHOST_HTTPS || "0").toLowerCase() === "1";
const fetchCloudinary =
  String(process.env.S3_FETCH_CLOUDINARY || "0").toLowerCase() === "1";

function encodeKeyForUrl(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function publicObjectUrl(key) {
  const encoded = encodeKeyForUrl(key);
  const explicit = process.env.S3_PUBLIC_URL_BASE?.replace(/\/$/, "");
  if (explicit) {
    return `${explicit}/${encoded}`;
  }
  if (forcePathStyle) {
    return `${endpoint}/${bucket}/${encoded}`;
  }
  const host = new URL(endpoint).host;
  return `https://${bucket}.${host}/${encoded}`;
}

function guessContentTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function guessContentTypeFromBuffer(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)
    return "image/webp";
  return "application/octet-stream";
}

function guessContentTypeFromUrl(url, buf) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  } catch {
    /* ignore */
  }
  return guessContentTypeFromBuffer(buf);
}

function objectKeyForRow(row, contentType) {
  const id = row.ID != null ? String(row.ID) : row.id != null ? String(row.id) : "row";
  const ext =
    contentType === "image/png"
      ? ".png"
      : contentType === "image/webp"
        ? ".webp"
        : contentType === "image/gif"
          ? ".gif"
          : ".jpg";
  return `${keyPrefix}/${id}${ext}`;
}

async function fetchSourceImage(url) {
  const isTwitter = url.includes("pbs.twimg.com");
  const res = await fetch(url, {
    headers: isTwitter
      ? {
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://twitter.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        }
      : {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (compatible; BegetS3Rehost/1.0; +https://beget.com)",
        },
  });
  if (!res.ok) {
    const hint = res.headers.get("x-cld-error");
    const extra = hint ? ` (${hint})` : "";
    throw new Error(`HTTP ${res.status}${extra}`);
  }
  return res.arrayBuffer();
}

const PATH_COLUMNS = [
  "local_file",
  "local_path",
  "file",
  "path",
  "файл",
  "путь",
];

function resolvePathFromColumn(row, cwd) {
  for (const col of PATH_COLUMNS) {
    if (row[col] == null || String(row[col]).trim() === "") continue;
    const raw = String(row[col]).trim();
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function findLocalFileForRow(row, dirAbs, cwd) {
  const fromCol = resolvePathFromColumn(row, cwd);
  if (fromCol) return fromCol;
  const id = row.ID ?? row.id;
  if (id == null) return null;
  const exts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  for (const ext of exts) {
    const abs = path.join(dirAbs, `${id}${ext}`);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

async function main() {
  if (!accessKeyId || !secretAccessKey) {
    console.error(
      "В cloudinary/.env: S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY (Beget)."
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const useLocal = Boolean(sourceDirEnv);
  const sourceDirAbs = useLocal ? path.resolve(cwd, sourceDirEnv) : null;

  console.log(`📦 S3: ${endpoint} / ${bucket}`);

  if (useLocal) {
    if (!fs.existsSync(sourceDirAbs) || !fs.statSync(sourceDirAbs).isDirectory()) {
      console.error(`Нет папки S3_SOURCE_DIR: ${sourceDirAbs}`);
      process.exit(1);
    }
    console.log(`📁 Локальные файлы: ${sourceDirAbs}`);
    console.log("   ({ID}.jpg … или колонка local_file / path)");
  } else {
    console.log(
      `🌐 По URL: pbs.twimg.com` +
        (fetchCloudinary ? ", res.cloudinary.com" : "") +
        (rehostAnyHttps ? "; + любой https (S3_REHOST_HTTPS=1)" : "")
    );
  }

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
  });

  console.log("🔄 Читаем prompts.xlsx...");
  const workbook = XLSX.readFile("prompts.xlsx");
  const sheetName = workbook.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  let success = 0,
    errors = 0,
    skipped = 0;

  for (const row of data) {
    const existingUrl = row.url != null ? String(row.url) : "";
    if (bucket && existingUrl.includes(bucket)) {
      skipped++;
      continue;
    }

    let body;
    let contentTypeHint = null;
    let sourceLabel = "";

    if (useLocal) {
      const localPath = findLocalFileForRow(row, sourceDirAbs, cwd);
      if (!localPath) {
        skipped++;
        continue;
      }
      body = fs.readFileSync(localPath);
      contentTypeHint = guessContentTypeFromPath(localPath);
      sourceLabel = path.relative(cwd, localPath) || localPath;
    } else {
      if (!row.url) {
        skipped++;
        continue;
      }
      const u = String(row.url);
      const isTwitter = u.includes("pbs.twimg.com/media");
      const isCloudinary =
        fetchCloudinary && u.includes("res.cloudinary.com");
      const isRehostHttps = rehostAnyHttps && u.startsWith("https://");
      if (!isTwitter && !isCloudinary && !isRehostHttps) {
        skipped++;
        continue;
      }
      try {
        const arrayBuf = await fetchSourceImage(row.url);
        body = Buffer.from(arrayBuf);
        contentTypeHint = guessContentTypeFromUrl(row.url, body);
        sourceLabel = u.substring(0, 60) + (u.length > 60 ? "…" : "");
      } catch (e) {
        console.error(`❌ ${row.ID ?? row.id ?? "N/A"} (URL): ${e.message}`);
        errors++;
        continue;
      }
    }

    try {
      console.log(`📤 ${row.ID ?? row.id ?? "N/A"} ← ${sourceLabel}`);

      const contentType =
        contentTypeHint && contentTypeHint !== "application/octet-stream"
          ? contentTypeHint
          : guessContentTypeFromBuffer(body);
      const key = objectKeyForRow(row, contentType);

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );

      row.url = publicObjectUrl(key);
      success++;
      console.log(`   ✅ ${row.url}`);
    } catch (e) {
      console.error(`❌ ${row.ID ?? row.id ?? "N/A"}: ${e.message}`);
      errors++;
    }
  }

  const newWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    newWb,
    XLSX.utils.json_to_sheet(data),
    "PROMPTS"
  );
  XLSX.writeFile(newWb, "prompts.xlsx");
  fs.writeFileSync("prompts.json", JSON.stringify(data, null, 2));

  console.log(`\n🎉 Готово. Успешно: ${success}, ошибок: ${errors}, пропуск: ${skipped}`);
  console.log(`📄 prompts.xlsx и prompts.json обновлены`);
}

main().catch(console.error);
