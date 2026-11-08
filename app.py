"""Фан-сайт madk1d на чистом Python (только стандартная библиотека).

Запуск:   py app.py
Открыть:  http://localhost:8000

Контент (фото, треки, клипы) подхватывается из папки media/ при каждом
обновлении страницы — просто положите файлы и нажмите F5:
  media/photos/  - фото (hero.jpg — главное фото на первом экране)
  media/music/   - треки (.mp3/.m4a/.ogg/...), имя файла = название трека,
                   формат «Исполнитель - Название.mp3» тоже понимается
  media/covers/  - обложки, имя как у трека (Название.jpg)
  media/clips/   - видео (.mp4/.webm) для блока «Фрагменты из клипов»
"""
import html
import json
import mimetypes
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, quote_plus, unquote

import os

HOST, PORT = "0.0.0.0", int(os.environ.get("PORT", 8000))  # хостинг сам задаёт PORT
BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
MEDIA = BASE / "media"
TEMPLATE = BASE / "templates" / "index.html"
WALL_FILE = BASE / "wall.json"

AUDIO_EXT = {".mp3", ".m4a", ".ogg", ".oga", ".opus", ".wav", ".flac", ".aac"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v"}
for ext, mime in {".opus": "audio/ogg", ".flac": "audio/flac", ".m4a": "audio/mp4",
                  ".webp": "image/webp", ".avif": "image/avif", ".webm": "video/webm",
                  ".m4v": "video/mp4", ".js": "text/javascript"}.items():
    mimetypes.add_type(mime, ext)

# =====================================================================
#   КОНТЕНТ — правьте здесь
# =====================================================================
ARTIST = "madk1d"
TAGLINE = ("Марк Серков из Томска. За пару лет прошёл путь от экспериментов "
           "на SoundCloud до одного из самых громких имён новой школы.")

BIO = ("<em>madk1d</em> — рэпер и хип-хоп-исполнитель из Томска. Энергичный вайб, "
       "ирония, цепкие хуки и эстетика 2010-х, понятная зумерам. Прорывом стал "
       "альбом <em>sexyswag</em>: треки разлетелись по TikTok сотнями тысяч роликов, "
       "а у артиста появились миллионы слушателей в месяц.")

FACTS = [
    "Настоящее имя — Марк Робертович Серков.",
    "Родился 11 апреля 2002 года в Томске.",
    "Начинал с экспериментальных треков на SoundCloud.",
    "По образованию сварщик — окончил техникум.",
    "VK Музыка отметила его наградой «за самый стремительный взлёт».",
]

RELEASES = [  # (год, тип, название, описание)
    ("2024", "Альбом", "Он сказал поехали!", "Дебютный альбом, вышел в январе 2024."),
    ("2025", "Альбом", "sexyswag", "Прорыв: «так пох*й», «ты че обиделась» и вирусный успех в TikTok."),
]
SINGLES = [  # (название, с кем)
    ("ДИНАСТИЯ", "с VILLIAN"),
    ("8 миля", "с VILLIAN"),
    ("Питер Паркер", ""),
    ("Распять", "с Greyrock, Tewiq"),
    ("КАТЮХА", "с LILCAK3"),
]

TICKER = ["sexyswag", "так пох*й", "ты че обиделась", "Он сказал поехали!",
          "ДИНАСТИЯ", "8 миля", "Питер Паркер", "Томск"]

SOCIALS = [  # (название, ссылка, подпись)
    ("Telegram", "https://t.me/madk1dmus", "@madk1dmus"),
    ("ВКонтакте", "https://vk.com/srkoff", "vk.com/srkoff"),
    ("VK Музыка", "https://vk.com/artist/madk1d", "страница артиста"),
    ("Яндекс Музыка", "https://music.yandex.ru/search?text=madk1d", "слушать"),
    ("YouTube", "https://www.youtube.com/results?search_query=madk1d", "клипы"),
]

# Исправленные названия треков (если имя файла обрезано): «имя файла без расширения» → название
TRACK_TITLES = {
    "madk1d - так по": "так пох*й",
}

# Фрагменты из клипов.
#   youtube — ID ролика (11 символов из ссылки youtube.com/watch?v=XXXXXXXXXXX)
#   file    — или имя локального файла из media/clips/
#   start / end — какой отрезок крутить в превью (в секундах), end = 0 → до конца;
#                 по клику клип открывается целиком, начиная со start
CLIPS = [
    {"title": "ДИНАСТИЯ", "artist": "VILLIAN, madk1d", "youtube": "",
     "file": "VILLIAN madk1d - ДИНАСТИЯ.mp4", "start": 45, "end": 60},
    {"title": "8 миля", "artist": "madk1d, VILLIAN", "youtube": "",
     "file": "madk1d VILLIAN - 8 миля.mp4", "start": 30, "end": 45},
    {"title": "Питер Паркер", "artist": "madk1d", "youtube": "",
     "file": "madk1d - Питер Паркер.mp4", "start": 35, "end": 50},
]

STREAMING = [
    ("Яндекс Музыка", "https://music.yandex.ru/search?text=madk1d"),
    ("VK Музыка", "https://vk.com/artist/madk1d"),
]
# =====================================================================


def _files(sub: str, exts: set) -> list:
    folder = MEDIA / sub
    if not folder.is_dir():
        return []
    return sorted((p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts),
                  key=lambda p: p.name.lower())


def _url(p: Path) -> str:
    return "/media/" + quote(p.relative_to(MEDIA).as_posix())


def list_media() -> dict:
    covers = {p.stem.lower(): _url(p) for p in _files("covers", IMAGE_EXT)}
    tracks = []
    for p in _files("music", AUDIO_EXT):
        name = re.sub(r"^\d+\s*[-._)]\s*", "", p.stem)       # «01 - Трек» → «Трек»
        artist, title = (name.split(" - ", 1) if " - " in name else (ARTIST, name))
        title = TRACK_TITLES.get(p.stem, title)
        tracks.append({"title": title.strip(), "artist": artist.strip(), "src": _url(p),
                       "cover": covers.get(p.stem.lower()) or covers.get(title.strip().lower())})
    photos = _files("photos", IMAGE_EXT)
    hero = next((p for p in photos if p.stem.lower() == "hero"), None)
    return {
        "tracks": tracks,
        "hero": _url(hero) if hero else (_url(photos[0]) if photos else None),
        "photos": [_url(p) for p in photos],
        "clips": [{"name": p.name, "title": p.stem, "src": _url(p)} for p in _files("clips", VIDEO_EXT)],
    }


def build_clips(media: dict) -> list:
    files = {c["name"]: c for c in media["clips"]}
    used, out = set(), []
    for c in CLIPS:
        artist = c.get("artist", ARTIST)
        f = c.get("file") or ""
        out.append({
            "title": c["title"], "artist": artist,
            "youtube": (c.get("youtube") or "").strip(),
            "src": files[f]["src"] if f in files else None,
            "start": int(c.get("start") or 0), "end": int(c.get("end") or 0),
            "search": "https://www.youtube.com/results?search_query=" + quote_plus(f"{artist} {c['title']}"),
        })
        used.add(f)
    for name, fc in files.items():
        if name not in used:
            out.append({"title": fc["title"], "artist": ARTIST, "youtube": "", "src": fc["src"],
                        "start": 0, "end": 0, "search": ""})
    return out


# ---------------- стена фанатов ----------------
_wall_lock = threading.Lock()
_last_post: dict = {}


def load_wall() -> list:
    try:
        data = json.loads(WALL_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def add_wall(ip: str, name: str, text: str):
    now = time.time()
    name = " ".join(str(name).split())[:24] or "аноним"
    text = str(text).strip()[:280]
    if not text:
        return None, "Сообщение пустое"
    with _wall_lock:
        if now - _last_post.get(ip, 0) < 8:
            return None, "Не так быстро — подожди пару секунд"
        wall = load_wall()
        msg = {"name": name, "text": text, "ts": int(now)}
        wall = (wall + [msg])[-300:]
        WALL_FILE.write_text(json.dumps(wall, ensure_ascii=False), encoding="utf-8")
        _last_post[ip] = now
    return msg, None


# ---------------- рендер ----------------
def render_page(static: bool = False) -> str:
    e = html.escape
    media = list_media()
    data = {"artist": ARTIST, "media": media, "clips": build_clips(media),
            "streaming": [{"name": n, "url": u} for n, u in STREAMING], "static": static}
    parts = {
        "%%TAGLINE%%": e(TAGLINE),
        "%%BIO%%": BIO,
        "%%TICKER%%": "".join(f"<span>{e(w)}</span>" for w in TICKER),
        "%%FACTS%%": "".join(f"<li>{e(f)}</li>" for f in FACTS),
        "%%RELEASES%%": "".join(
            f'<article class="release reveal tilt"><span class="year">{e(y)}</span>'
            f'<span class="type">{e(t)}</span><h3>{e(n)}</h3><p class="muted">{e(d)}</p></article>'
            for y, t, n, d in RELEASES),
        "%%SINGLES%%": "".join(
            f'<span class="chip">{e(n)}{f" <small>{e(w)}</small>" if w else ""}</span>' for n, w in SINGLES),
        "%%SOCIALS%%": "".join(
            f'<li><a href="{e(u)}" target="_blank" rel="noopener"><span><span class="ln">{e(n)}</span>'
            f'<span class="lh">{e(h)}</span></span><span class="arrow">↗</span></a></li>'
            for n, u, h in SOCIALS),
    }
    page = TEMPLATE.read_text(encoding="utf-8")
    for k, v in parts.items():
        page = page.replace(k, v)
    return page.replace("%%DATA%%", json.dumps(data, ensure_ascii=False).replace("<", "\\u003c"))


class Handler(BaseHTTPRequestHandler):
    server_version = "madk1d"

    def log_message(self, fmt, *args):
        if "/media/" not in (self.path or ""):
            super().log_message(fmt, *args)

    def _send(self, body: bytes, ctype: str, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, status: int = 200):
        self._send(json.dumps(data, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8", status)

    def _file(self, root: Path, rel: str, cache: str):
        """Отдача файла с поддержкой Range — нужна для перемотки аудио и видео."""
        try:
            target = (root / unquote(rel)).resolve()
        except (OSError, ValueError):
            target = None
        if not target or root not in target.parents or not target.is_file():
            return self._send(b"404 Not Found", "text/plain", 404)

        size = target.stat().st_size
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("json"):
            ctype += "; charset=utf-8"

        start, end, status = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)$", (self.headers.get("Range") or "").strip())
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            status = 206

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", cache)
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(target, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(256 * 1024, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # браузер оборвал загрузку (перемотка/смена трека) — это нормально

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            self._send(render_page().encode("utf-8"), "text/html; charset=utf-8")
        elif path.startswith("/static/"):
            self._file(STATIC, path[len("/static/"):], "no-cache")
        elif path.startswith("/media/"):
            self._file(MEDIA, path[len("/media/"):], "max-age=3600")
        elif path == "/api/wall":
            self._json(load_wall()[-100:])
        else:
            self._send(b"404 Not Found", "text/plain", 404)

    def do_POST(self):
        if self.path != "/api/wall":
            return self._send(b"404 Not Found", "text/plain", 404)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= 4096:
                raise ValueError
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._json({"ok": False, "error": "Некорректный запрос"}, 400)
        msg, err = add_wall(self.client_address[0], body.get("name", ""), body.get("text", ""))
        if err:
            return self._json({"ok": False, "error": err}, 429 if "быстро" in err else 400)
        self._json({"ok": True, "msg": msg})


if __name__ == "__main__":
    for sub in ("photos", "music", "covers", "clips"):
        (MEDIA / sub).mkdir(parents=True, exist_ok=True)
    print(f"Сайт запущен: http://localhost:{PORT}  (Ctrl+C для остановки)")
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
