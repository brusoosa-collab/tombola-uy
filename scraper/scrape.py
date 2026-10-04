"""Recolector del historial de la Tombola uruguaya (DNLQ).

Fuente oficial: https://www.loteria.gub.uy/ver_resultados.php?vdia=D&vmes=M&vano=Y
Salida: data/tombola.json
"""

from __future__ import annotations

import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "tombola.json"

START = date(2022, 1, 1)
WORKERS = 6
URUGUAY_TZ = timezone(timedelta(hours=-3))

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-UY,es;q=0.9",
}

MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "setiembre": 9, "septiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

VALUE_RE = re.compile(r'text_azul_3">\s*(\d+)\s*<')
SECTION_RE = re.compile(
    r"cabezal_quinielas_(vespertina|nocturno)\.png(.*?)(?=cabezal_quinielas_|$)",
    re.S,
)
DATE_RE = re.compile(
    r"(\d{1,2}) de (Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|"
    r"Setiembre|Septiembre|Octubre|Noviembre|Diciembre) de (\d{4})",
    re.I,
)
CALENDAR_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
CALENDAR_DAY_IMAGE_RE = re.compile(r"(?:^|/)CALENDARIOS_PROGRAMAS/(\d+)\.png$", re.I)
NO_DRAWS_IMAGE = "logo_no_hay_sorteos.jpg"

_local = threading.local()


class _CalendarImages(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() == "img":
            src = dict(attrs).get("src")
            if src:
                self.sources.append(src.replace("\\", "/"))


def source_url(day: date) -> str:
    return (
        "https://www.loteria.gub.uy/ver_resultados.php"
        f"?vdia={day.day}&vmes={day.month}&vano={day.year}"
    )


def fetch(day: date, retries: int = 3) -> str:
    if not hasattr(_local, "opener"):
        _local.opener = urllib.request.build_opener()
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(source_url(day), headers=HEADERS)
            with _local.opener.open(req, timeout=30) as resp:
                return resp.read().decode("latin-1", "ignore")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            time.sleep(1.0 * (attempt + 1))
    raise last if last else RuntimeError("fetch falló")


def fetch_calendar(retries: int = 3) -> str:
    url = "https://www.loteria.gub.uy/ver_calendario.php"
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("latin-1", "ignore")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            time.sleep(1.0 * (attempt + 1))
    raise last if last else RuntimeError("consulta del calendario falló")


def parse_calendar_no_draws(html: str) -> tuple[str, list[str]]:
    stamp = CALENDAR_DATE_RE.search(html)
    if not stamp:
        raise ValueError("el calendario DNLQ no incluye una fecha reconocible")
    day, month, year = map(int, stamp.groups())
    displayed_month = date(year, month, day).strftime("%Y-%m")

    parser = _CalendarImages()
    parser.feed(html)
    no_draws: set[str] = set()
    for i, src in enumerate(parser.sources):
        match = CALENDAR_DAY_IMAGE_RE.search(src)
        if not match:
            continue
        day_number = int(match.group(1))
        if day_number == 0:
            continue
        try:
            calendar_day = date(year, month, day_number)
        except ValueError:
            continue
        for following in parser.sources[i + 1 :]:
            if CALENDAR_DAY_IMAGE_RE.search(following):
                break
            if following.rsplit("/", 1)[-1].lower() == NO_DRAWS_IMAGE:
                no_draws.add(calendar_day.isoformat())
                break
    return displayed_month, sorted(no_draws)


def page_dates(html: str) -> set[date]:
    found: set[date] = set()
    for d, month, y in DATE_RE.findall(html):
        m = MESES.get(month.lower())
        if m:
            try:
                found.add(date(int(y), m, int(d)))
            except ValueError:
                pass
    return found


def parse(day: date, html: str) -> list[dict]:
    if day not in page_dates(html):
        return []
    draws: list[dict] = []
    for period, block in SECTION_RE.findall(html):
        values = VALUE_RE.findall(block)
        if len(values) < 40:
            continue
        numbers = values[20:40]
        if any(len(n) != 2 for n in numbers):
            continue
        parsed = sorted(int(n) for n in numbers)
        if len(set(parsed)) < 20:
            continue
        draws.append(
            {
                "date": day.isoformat(),
                "period": "vespertina" if period == "vespertina" else "nocturna",
                "numbers": parsed,
            }
        )
    return draws


def load() -> dict:
    if OUT.exists():
        return json.loads(OUT.read_text(encoding="utf-8"))
    return {
        "game": "Tombola Uruguay (DNLQ)",
        "source": "https://www.loteria.gub.uy/",
        "range": {},
        "draws": [],
        "calendar_month": "",
        "no_draw_dates": [],
    }


def draw_sort_key(draw: dict) -> tuple[str, int]:
    """Ordena por fecha y hora del sorteo, no alfabéticamente por período."""
    period_order = {"vespertina": 0, "nocturna": 1}
    return draw["date"], period_order[draw["period"]]


def save(data: dict) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data["draws"].sort(key=draw_sort_key)
    if data["draws"]:
        data["range"] = {
            "from": data["draws"][0]["date"],
            "to": data["draws"][-1]["date"],
        }
    OUT.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def day_list(start: date = START, end: date | None = None) -> list[date]:
    end = end or datetime.now(URUGUAY_TZ).date()
    days, cur = [], start
    while cur <= end:
        # La DNLQ programa los sorteos regulares de lunes a sábado; domingos no.
        if cur.weekday() < 6:
            days.append(cur)
        cur += timedelta(days=1)
    return days


def collect() -> None:
    data = load()
    positions = {
        (draw["date"], draw["period"]): i
        for i, draw in enumerate(data["draws"])
    }
    if positions:
        latest = max(date.fromisoformat(draw_date) for draw_date, _ in positions)
        start = max(START, latest - timedelta(days=14))
    else:
        start = START
    days = day_list(start, datetime.now(URUGUAY_TZ).date())
    added = 0
    corrected = 0
    errors: list[str] = []
    done = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch, d): d for d in days}
        for fut in as_completed(futures):
            day = futures[fut]
            done += 1
            try:
                html = fut.result()
            except Exception as exc:
                errors.append(f"{day}: {exc}")
                continue
            for draw in parse(day, html):
                key = (draw["date"], draw["period"])
                if key in positions:
                    index = positions[key]
                    if data["draws"][index]["numbers"] != draw["numbers"]:
                        data["draws"][index] = draw
                        corrected += 1
                else:
                    data["draws"].append(draw)
                    positions[key] = len(data["draws"]) - 1
                    added += 1
            if done % 300 == 0:
                save(data)
                print(f"  {done}/{len(days)}  sorteos={len(data['draws'])}", flush=True)

    try:
        data["calendar_month"], data["no_draw_dates"] = parse_calendar_no_draws(fetch_calendar())
    except Exception as exc:
        errors.append(f"calendario DNLQ: {exc}")

    data["last_checked_at"] = datetime.now(URUGUAY_TZ).isoformat(timespec="seconds")
    data["last_check_errors"] = len(errors)
    save(data)
    print(f"dias consultados : {len(days)}")
    print(f"sorteos agregados: {added}")
    print(f"sorteos corregidos: {corrected}")
    print(f"mes calendario    : {data.get('calendar_month', '')}")
    print(f"sin sorteos       : {', '.join(data.get('no_draw_dates', [])) or 'ningún día adicional'}")
    print(f"sorteos totales  : {len(data['draws'])}")
    if data["draws"]:
        print(f"rango            : {data['range']['from']} -> {data['range']['to']}")
    if errors:
        print(f"errores          : {len(errors)}")
        for e in errors[:5]:
            print("   ", e)


if __name__ == "__main__":
    sys.exit(collect())
