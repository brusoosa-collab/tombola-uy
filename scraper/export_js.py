"""Normaliza el historial y lo exporta como JS (usable desde file://)."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / "data" / "tombola.json"
dst = ROOT / "data" / "tombola.js"

data = json.loads(src.read_text(encoding="utf-8"))
period_order = {"vespertina": 0, "nocturna": 1}
data["draws"].sort(key=lambda d: (d["date"], period_order[d["period"]]))
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
src.write_text(payload, encoding="utf-8")
dst.write_text(
    "window.TOMBOLA_DATA=" + payload + ";\n",
    encoding="utf-8",
)
print(
    f"{src.name} y {dst.name}: {dst.stat().st_size // 1024} KB, "
    f"{len(data['draws'])} sorteos (orden cronológico)"
)
