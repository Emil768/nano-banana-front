#!/usr/bin/env python3
"""Публикует пост из канала: модалка на сайте + пересылка всем в боте.

  python3 scripts/publish_news.py 42            # всё сразу: сайт + рассылка
  python3 scripts/publish_news.py 42 --test     # переслать только себе (TEST_CHAT_ID)
  python3 scripts/publish_news.py 42 --dry-run  # посчитать получателей, ничего не слать
  python3 scripts/publish_news.py 42 --only-site
  python3 scripts/publish_news.py 42 --only-tg
  python3 scripts/publish_news.py --off         # убрать модалку с сайта

42 — номер поста (последнее число в ссылке t.me/neiroBananchik/42).
Скрин поста — самая свежая картинка в scripts/news/ (jpg, png, webp).

Получатели — user_settings, где status пустой или 'null', только Telegram-id
(Google-юзеры с id на «g» в боте недоступны — им показывается модалка на сайте).
Кто заблокировал бота, тому сразу ставится status = 'blocked'.

Ключи: TG_BOT_TOKEN — scripts/.env, SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY — backend/.env.
"""
import argparse
import base64
import time
from pathlib import Path

import requests

# ===== НАСТРОЙКИ =====
GROUP_ID = "-1003474679504"  # id канала, откуда пересылаем пост
CHANNEL = "neiroBananchik"  # username канала — для ссылки на сайте
TEST_CHAT_ID = ""  # твой chat_id для --test
# =====================

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
NEWS_DIR = SCRIPT_DIR / "news"
USERS_TABLE = "user_settings"
IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
MAX_IMAGE_BYTES = 2 * 1024 * 1024


def read_env(path, key):
  if path.exists():
    for line in path.read_text(encoding="utf-8").splitlines():
      name, _, value = line.partition("=")
      if name.strip() == key:
        return value.strip().strip("'\"")
  return ""


class Supabase:
  def __init__(self):
    env = ROOT / "backend" / ".env"
    self.url = read_env(env, "SUPABASE_URL").rstrip("/")
    key = read_env(env, "SUPABASE_SERVICE_ROLE_KEY")
    if not self.url or not key:
      raise SystemExit("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в backend/.env")
    self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

  def request(self, method, table, params=None, json=None, headers=None):
    response = requests.request(
      method,
      f"{self.url}/rest/v1/{table}",
      params=params,
      json=json,
      headers={**self.headers, **(headers or {})},
      timeout=60,
    )
    if not response.ok:
      raise SystemExit(f"Supabase {method} {table}: {response.status_code} {response.text[:300]}")
    return response


# ---------- Сайт ----------

def find_screenshot():
  images = [p for p in NEWS_DIR.glob("*") if p.suffix.lower() in IMAGE_TYPES]
  if not images:
    raise SystemExit(f"Положи скрин поста в {NEWS_DIR.relative_to(ROOT)}/ (jpg, png или webp)")
  image = max(images, key=lambda p: p.stat().st_mtime)
  if image.stat().st_size > MAX_IMAGE_BYTES:
    raise SystemExit(f"{image.name} весит больше 2 МБ — пережми (webp/jpg, до ~1080px по ширине)")
  return image


def publish_site(db, post_id, dry_run):
  image = find_screenshot()
  link = f"https://t.me/s/{CHANNEL}/{post_id}"
  print(f"Сайт: скрин {image.name}, ссылка {link}")
  if dry_run:
    return

  db.request("POST", "news", json={
    "post_id": post_id,
    "link": link,
    "image_base64": base64.b64encode(image.read_bytes()).decode("ascii"),
    "image_type": IMAGE_TYPES[image.suffix.lower()],
  }, headers={"Prefer": "return=minimal"})
  print("Сайт: новость опубликована (появится у юзеров в течение минуты)\n")


def turn_off_site(db):
  db.request("PATCH", "news", params={"active": "eq.true"}, json={"active": False},
             headers={"Prefer": "return=minimal"})
  print("Модалка с новостью на сайте выключена (в течение минуты)")


# ---------- Telegram ----------

def load_recipients(db):
  ids, page = [], 1000
  while True:
    rows = db.request("GET", USERS_TABLE, params={
      "select": "id",
      "or": '(status.is.null,status.eq."null")',
      "order": "id",
      "offset": len(ids),
      "limit": page,
    }).json()
    ids.extend(str(row["id"]) for row in rows)
    if len(rows) < page:
      break
  ids = list(dict.fromkeys(ids))
  # Только Telegram-id: Google-юзеры (g…) боту недоступны, им — модалка на сайте.
  tg_ids = [i for i in ids if i.lstrip("-").isdigit()]
  google_count = sum(1 for i in ids if i.startswith("g"))
  return tg_ids, google_count


def forward(token, chat_id, post_id):
  url = f"https://api.telegram.org/bot{token}/forwardMessage"
  data = {"chat_id": chat_id, "from_chat_id": GROUP_ID, "message_id": post_id}
  for _ in range(3):
    try:
      result = requests.post(url, data=data, timeout=20).json()
    except Exception as error:
      result = {"ok": False, "description": str(error)}
    retry_after = (result.get("parameters") or {}).get("retry_after")
    if result.get("error_code") == 429 and retry_after:
      time.sleep(retry_after + 1)
      continue
    return result
  return result


def mark_blocked(db, blocked):
  for start in range(0, len(blocked), 200):
    chunk = blocked[start:start + 200]
    db.request("PATCH", USERS_TABLE, params={"id": f"in.({','.join(chunk)})"},
               json={"status": "blocked"}, headers={"Prefer": "return=minimal"})
  print(f"В базе помечены как blocked: {len(blocked)}")


def broadcast(db, token, post_id, chat_ids):
  total = len(chat_ids)
  ok_count, blocked = 0, []
  for index, chat_id in enumerate(chat_ids, start=1):
    result = forward(token, chat_id, post_id)
    if result.get("ok"):
      ok_count += 1
      print(f"[{index}/{total}] OK   {chat_id}")
    else:
      if result.get("error_code") == 403:
        blocked.append(chat_id)
      print(f"[{index}/{total}] FAIL {chat_id} -> {result.get('description')}")
    time.sleep(0.05)

  print(f"\nГотово. Доставлено: {ok_count}, не доставлено: {total - ok_count}, заблокировали: {len(blocked)}")
  if blocked and db:
    mark_blocked(db, blocked)


# ---------- main ----------

def main():
  parser = argparse.ArgumentParser(description="Пост из канала → сайт + рассылка в боте")
  parser.add_argument("post_id", nargs="?", type=int, help="номер поста в канале")
  parser.add_argument("--test", action="store_true", help="переслать только себе (TEST_CHAT_ID)")
  parser.add_argument("--dry-run", action="store_true", help="ничего не отправлять, только посчитать")
  parser.add_argument("--only-site", action="store_true", help="только модалка на сайте")
  parser.add_argument("--only-tg", action="store_true", help="только рассылка в боте")
  parser.add_argument("--off", action="store_true", help="убрать модалку с сайта")
  args = parser.parse_args()

  if args.off:
    turn_off_site(Supabase())
    return
  if not args.post_id:
    parser.error("укажи номер поста, например: python3 scripts/publish_news.py 42")

  token = read_env(SCRIPT_DIR / ".env", "TG_BOT_TOKEN")
  if not token:
    raise SystemExit("Нет TG_BOT_TOKEN в scripts/.env")

  if args.test:
    if not TEST_CHAT_ID:
      raise SystemExit("Впиши свой chat_id в TEST_CHAT_ID вверху скрипта")
    broadcast(None, token, args.post_id, [TEST_CHAT_ID])
    return

  db = Supabase()
  send_site = not args.only_tg
  send_tg = not args.only_site

  chat_ids, google_count = load_recipients(db)
  print(f"Пост {args.post_id} из {GROUP_ID}")
  if send_tg:
    print(f"Telegram: получателей {len(chat_ids)}")
  print(f"Google-юзеров в базе: {google_count} (им в бот не отправить — увидят модалку на сайте)")
  if send_site:
    find_screenshot()  # проверяем скрин до вопроса, а не после

  if args.dry_run:
    if send_site:
      publish_site(db, args.post_id, dry_run=True)
    print("\n--dry-run: ничего не отправлено")
    return

  if input("\nПубликуем? [y/N] ").strip().lower() not in ("y", "yes", "д", "да"):
    print("Отмена")
    return

  if send_site:
    publish_site(db, args.post_id, dry_run=False)
  if send_tg:
    broadcast(db, token, args.post_id, chat_ids)


if __name__ == "__main__":
  main()
