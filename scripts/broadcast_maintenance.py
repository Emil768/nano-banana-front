#!/usr/bin/env python3
import argparse
import os
import time
from pathlib import Path

import requests


def parse_args():
  parser = argparse.ArgumentParser(
    description="Broadcast text or Telegram post to chat_id list"
  )
  parser.add_argument(
    "--chat-ids-file",
    default="scripts/chat_ids.txt",
    help="Path to file with chat_id values (one per line)",
  )
  parser.add_argument(
    "--message",
    default="Еще раз привет! Бот сейчас должен работать, так что беги проверяй! А еще мы подготовили для тебя веб-версию смотри https://nanobananaa.ru/generate.html, будем рады если ты ее тоже попробуешь!",
    help="Text for sendMessage mode",
  )
  parser.add_argument(
    "--copy-from-chat-id",
    help="Source chat/channel id for copyMessage mode (e.g. -100123...)",
  )
  parser.add_argument(
    "--copy-message-id",
    type=int,
    help="Source message_id for copyMessage mode",
  )
  parser.add_argument(
    "--forward-from-chat-id",
    help="Source chat/channel id for forwardMessage mode (e.g. -100123...)",
  )
  parser.add_argument(
    "--forward-message-id",
    type=int,
    help="Source message_id for forwardMessage mode",
  )
  parser.add_argument(
    "--delay",
    type=float,
    default=0.08,
    help="Delay between messages in seconds",
  )
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Do not send, only print recipients count",
  )
  return parser.parse_args()


def load_env_file(path: Path):
  if not path.exists():
    return
  for line in path.read_text(encoding="utf-8").splitlines():
    raw = line.strip()
    if not raw or raw.startswith("#") or "=" not in raw:
      continue
    key, value = raw.split("=", 1)
    key = key.strip()
    value = value.strip().strip("'\"")
    if key and key not in os.environ:
      os.environ[key] = value


def load_chat_ids(path: Path):
  if not path.exists():
    raise FileNotFoundError(f"File not found: {path}")

  ids = []
  for line in path.read_text(encoding="utf-8").splitlines():
    value = line.strip()
    if not value or value.startswith("#"):
      continue
    ids.append(value)
  return ids


def parse_response(response):
  try:
    return response.json()
  except Exception:
    return {
      "ok": False,
      "description": f"HTTP {response.status_code}: {response.text[:300]}",
    }


def send_message(bot_token: str, chat_id: str, text: str):
  url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
  response = requests.post(url, data={"chat_id": chat_id, "text": text}, timeout=20)
  return parse_response(response)


def copy_message(bot_token: str, chat_id: str, from_chat_id: str, message_id: int):
  url = f"https://api.telegram.org/bot{bot_token}/copyMessage"
  response = requests.post(
    url,
    data={
      "chat_id": chat_id,
      "from_chat_id": from_chat_id,
      "message_id": message_id,
    },
    timeout=20,
  )
  return parse_response(response)


def forward_message(bot_token: str, chat_id: str, from_chat_id: str, message_id: int):
  url = f"https://api.telegram.org/bot{bot_token}/forwardMessage"
  response = requests.post(
    url,
    data={
      "chat_id": chat_id,
      "from_chat_id": from_chat_id,
      "message_id": message_id,
    },
    timeout=20,
  )
  return parse_response(response)


def main():
  args = parse_args()
  
  args.forward_from_chat_id = "-1003474679504"  # Группа @neiroBananchik
  args.forward_message_id = 19               # Сообщение
  args.chat_ids_file = "chat_ids.txt"   # 1 юзер для теста

  load_env_file(Path("scripts/.env"))
  token = os.getenv("TG_BOT_TOKEN", "").strip()
  if not token:
    raise SystemExit("Set TG_BOT_TOKEN in scripts/.env or environment.")

  recipients = load_chat_ids(Path(args.chat_ids_file))
  if not recipients:
    raise SystemExit(f"No chat_id values in {args.chat_ids_file}")

  is_copy_mode = bool(args.copy_from_chat_id and args.copy_message_id)
  is_forward_mode = bool(args.forward_from_chat_id and args.forward_message_id)
  if is_copy_mode and is_forward_mode:
    raise SystemExit("Use either copy mode or forward mode, not both.")
  if args.copy_from_chat_id and not args.copy_message_id:
    raise SystemExit("Provide --copy-message-id with --copy-from-chat-id.")
  if args.copy_message_id and not args.copy_from_chat_id:
    raise SystemExit("Provide --copy-from-chat-id with --copy-message-id.")
  if args.forward_from_chat_id and not args.forward_message_id:
    raise SystemExit("Provide --forward-message-id with --forward-from-chat-id.")
  if args.forward_message_id and not args.forward_from_chat_id:
    raise SystemExit("Provide --forward-from-chat-id with --forward-message-id.")

  mode = "sendMessage"
  if is_copy_mode:
    mode = "copyMessage"
  if is_forward_mode:
    mode = "forwardMessage"
  print(f"Mode: {mode}")
  print(f"Recipients: {len(recipients)}")
  if args.dry_run:
    print("Dry run completed. Nothing sent.")
    return

  ok_count = 0
  fail_count = 0
  total = len(recipients)

  for index, chat_id in enumerate(recipients, start=1):
    if is_copy_mode:
      result = copy_message(token, chat_id, args.copy_from_chat_id, args.copy_message_id)
    elif is_forward_mode:
      result = forward_message(
        token,
        chat_id,
        args.forward_from_chat_id,
        args.forward_message_id,
      )
    else:
      result = send_message(token, chat_id, args.message)

    if result.get("ok"):
      ok_count += 1
      print(f"[{index}/{total}] OK   chat_id={chat_id}")
    else:
      fail_count += 1
      description = result.get("description", "unknown error")
      print(f"[{index}/{total}] FAIL chat_id={chat_id} -> {description}")

    time.sleep(max(args.delay, 0))

  print("")
  print(f"Done. Success: {ok_count}, Failed: {fail_count}, Total: {total}")


if __name__ == "__main__":
  main()
