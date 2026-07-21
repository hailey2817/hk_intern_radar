import json
from http.server import BaseHTTPRequestHandler
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def load_payload():
    research = read_json(DATA / "research_results.json", None) or read_json(DATA / "seed_research.json", {
        "generatedAt": None,
        "cycle": "Winter 2026-27 and Summer 2027",
        "summary": {},
        "opportunities": [],
        "watchlist": [],
        "changes": [],
    })
    opportunities = research.get("opportunities", [])
    watchlist = research.get("watchlist", [])
    covered = {str(item.get("company", "")).casefold() for item in opportunities + watchlist}
    for company in read_json(DATA / "company_universe.json", []):
        if str(company.get("company", "")).casefold() in covered:
            continue
        watchlist.append({
            "company": company.get("company"),
            "role": company.get("segment", "Internship programme"),
            "category": company.get("category"),
            "sourceUrl": company.get("sourceUrl"),
            "notes": company.get("reason"),
            "priority": company.get("priority", "Expanded"),
            "dateConfidence": "watchlist-unconfirmed",
        })
    for index, item in enumerate(opportunities, 1):
        item.setdefault("id", f"hosted-{index:03d}")
        item.setdefault("pipelineStatus", "Interested")
        item.setdefault("priority", "Medium")
        item.setdefault("userNotes", "")
    return {
        "items": opportunities,
        "watchlist": watchlist,
        "changes": research.get("changes", []),
        "meta": {
            "count": len(opportunities),
            "generatedAt": research.get("generatedAt"),
            "cycle": research.get("cycle"),
            "summary": research.get("summary", {}),
            "researchStatus": {
                "status": "complete" if research.get("generatedAt") else "waiting",
                "message": "Hosted research data is updated through GitHub deployments.",
            },
            "refreshRequest": {"requested": False},
            "scheduledResearch": "Weekly research publication",
            "deploymentMode": "vercel",
            "refreshSupported": False,
        },
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(load_payload(), ensure_ascii=True).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=60, s-maxage=300")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
