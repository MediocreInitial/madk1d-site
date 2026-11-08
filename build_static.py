"""Сборка статической версии сайта для GitHub Pages.

Запуск:  python build_static.py
Результат: папка dist/ (index.html + static/ + media/) с относительными путями,
поэтому сайт работает по любому адресу, в том числе https://ник.github.io/madk1d-site/
"""
import shutil
from pathlib import Path

import app

DIST = app.BASE / "dist"


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    page = app.render_page(static=True)
    # абсолютные пути → относительные (иначе на github.io/репозиторий/ всё сломается)
    page = page.replace('"/static/', '"static/').replace('/media/', 'media/')
    (DIST / "index.html").write_text(page, encoding="utf-8")

    shutil.copytree(app.STATIC, DIST / "static")
    if app.MEDIA.exists():
        shutil.copytree(app.MEDIA, DIST / "media")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")   # отключаем Jekyll
    print(f"Готово: {DIST}")


if __name__ == "__main__":
    main()
