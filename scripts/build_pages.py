#!/usr/bin/env python3
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "_site"
if SITE.exists():
    shutil.rmtree(SITE)
shutil.copytree(ROOT / "public", SITE)
(SITE / "data").mkdir()
for name in ("research_results.json", "seed_research.json", "company_universe.json", "research_status.json"):
    source = ROOT / "data" / name
    if source.exists():
        shutil.copy2(source, SITE / "data" / name)
