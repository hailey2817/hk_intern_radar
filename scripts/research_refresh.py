#!/usr/bin/env python3
"""Refresh the public internship research feed from official employer pages."""

from __future__ import annotations

import html
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UNIVERSE_FILE = DATA / "company_universe.json"
SEED_FILE = DATA / "seed_research.json"
RESULT_FILE = DATA / "research_results.json"
STATUS_FILE = DATA / "research_status.json"
TODAY = date.today()
MAX_WORKERS = 10
TIMEOUT = 18

ROLE_WORDS = re.compile(r"\b(intern(?:ship)?|summer analyst|winter analyst|seasonal analyst|off[- ]cycle|student programme|student program)\b", re.I)
HK_WORDS = re.compile(r"\b(hong kong|hong-kong|hongkong|central,? hong kong|hksar)\b", re.I)
CYCLE_WORDS = re.compile(r"\b(2027|2026\s*[-/]\s*27|winter|summer)\b", re.I)
PUBLISHABLE_CYCLE = re.compile(r"\b(2027|2026\s*[-/]\s*27)\b", re.I)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
LINK_RE = re.compile(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
NAVIGATION_LABELS = re.compile(r"^(skip|view map|map|main content|back|next|previous|learn more|read more)$", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def clean_text(value: str) -> str:
    return SPACE_RE.sub(" ", html.unescape(TAG_RE.sub(" ", value))).strip()


def scan_company(company: dict) -> dict:
    url = company["sourceUrl"]
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; HKInternshipRadar/2.0; public research monitor)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-HK,en;q=0.9",
        },
    )
    result = {
        **company,
        "checkedAt": now_iso(),
        "reachable": False,
        "httpStatus": None,
        "pageTitle": None,
        "signals": [],
        "discoveredRoles": [],
        "error": None,
    }
    try:
        context = ssl.create_default_context()
        with urllib.request.urlopen(request, timeout=TIMEOUT, context=context) as response:
            payload = response.read(550_000).decode("utf-8", errors="ignore")
            result["httpStatus"] = response.getcode()
            result["reachable"] = 200 <= response.getcode() < 400
            resolved_url = response.geturl()
            title_match = TITLE_RE.search(payload)
            result["pageTitle"] = clean_text(title_match.group(1))[:180] if title_match else None
            page_text = clean_text(payload)
            if ROLE_WORDS.search(page_text):
                result["signals"].append("internship-language")
            if HK_WORDS.search(page_text):
                result["signals"].append("hong-kong-language")
            if CYCLE_WORDS.search(page_text):
                result["signals"].append("cycle-language")

            seen = set()
            direct_signal = f"{result['pageTitle'] or ''} {resolved_url}"
            if ROLE_WORDS.search(direct_signal) and HK_WORDS.search(direct_signal) and PUBLISHABLE_CYCLE.search(direct_signal):
                direct_url = resolved_url.split("#", 1)[0]
                result["discoveredRoles"].append({"title": result["pageTitle"] or "Hong Kong internship", "url": direct_url})
                seen.add(direct_url)
            for href, label_html in LINK_RE.findall(payload):
                label = clean_text(label_html)
                if len(label) < 8 or NAVIGATION_LABELS.match(label):
                    continue
                absolute = urllib.parse.urljoin(resolved_url, html.unescape(href))
                candidate = f"{label} {absolute}"
                if not ROLE_WORDS.search(candidate) or not HK_WORDS.search(candidate):
                    continue
                if not PUBLISHABLE_CYCLE.search(candidate):
                    continue
                parsed_source = urllib.parse.urlparse(resolved_url)
                parsed_candidate = urllib.parse.urlparse(absolute)
                if parsed_candidate.netloc and parsed_source.netloc not in parsed_candidate.netloc and parsed_candidate.netloc not in parsed_source.netloc:
                    continue
                key = absolute.split("#", 1)[0]
                if key in seen:
                    continue
                seen.add(key)
                result["discoveredRoles"].append({"title": label[:180] or "Hong Kong internship", "url": key})
                if len(result["discoveredRoles"]) >= 8:
                    break
    except urllib.error.HTTPError as exc:
        result["httpStatus"] = exc.code
        result["reachable"] = exc.code in {401, 403, 429}
        result["error"] = f"HTTP {exc.code}"
    except Exception as exc:
        result["error"] = str(exc)[:220]
    return result


def deadline_is_future(item: dict) -> bool:
    value = item.get("closingDate")
    if not value:
        return True
    try:
        return date.fromisoformat(value[:10]) >= TODAY
    except ValueError:
        return True


def stable_id(company: str, role: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", f"{company}-{role}".casefold()).strip("-")
    return slug[:90]


def main() -> None:
    started = now_iso()
    write_json(STATUS_FILE, {"status": "running", "startedAt": started, "completedAt": None, "message": "Scanning official employer sources"})
    universe = read_json(UNIVERSE_FILE, [])
    seed = read_json(SEED_FILE, {"opportunities": [], "watchlist": [], "changes": []})
    previous = read_json(RESULT_FILE, {})
    scans = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(scan_company, company): company for company in universe}
        for future in as_completed(futures):
            scans.append(future.result())
    scans.sort(key=lambda item: (item.get("category", ""), item.get("company", "")))
    scan_by_company = {item["company"].casefold(): item for item in scans}

    opportunities = []
    changes = []
    previous_keys = {(item.get("company", "").casefold(), item.get("role", "").casefold()) for item in previous.get("opportunities", [])}
    for item in seed.get("opportunities", []):
        if not deadline_is_future(item):
            changes.append({"type": "closed", "message": f"{item.get('company')}: {item.get('role')} passed its published deadline."})
            continue
        scan = scan_by_company.get(str(item.get("company", "")).casefold(), {})
        entry = dict(item)
        entry["lastVerified"] = scan.get("checkedAt", started)
        entry["sourceReachable"] = scan.get("reachable")
        entry["sourceHttpStatus"] = scan.get("httpStatus")
        entry.setdefault("id", stable_id(entry.get("company", ""), entry.get("role", "")))
        opportunities.append(entry)

    known_urls = {item.get("sourceUrl") for item in opportunities}
    for scan in scans:
        for discovered in scan.get("discoveredRoles", []):
            if discovered["url"] in known_urls:
                continue
            role = discovered["title"]
            entry = {
                "id": stable_id(scan["company"], role),
                "company": scan["company"],
                "role": role,
                "category": scan["category"],
                "segment": scan.get("segment"),
                "season": "2027 cycle - verify on official page",
                "location": "Hong Kong",
                "applicationStatus": "Open / verify details",
                "openingDate": None,
                "closingDate": None,
                "deadlineTimezone": "Confirm on official page",
                "rolling": "Unknown",
                "placementTimeline": "Confirm on official page",
                "nextAction": "Open the official listing and confirm eligibility and deadline",
                "description": "New Hong Kong internship link discovered on the employer's official careers site.",
                "requirements": "Confirm on official listing",
                "languageWorkRights": "Confirm on official listing",
                "recruitmentStages": "Confirm on official listing",
                "documents": "CV; transcript if requested; work-authorization details",
                "sourceUrl": discovered["url"],
                "confidence": "Official-link discovery; details require verification",
                "notes": scan.get("reason", ""),
                "lastVerified": scan["checkedAt"],
                "sourceReachable": scan["reachable"],
                "sourceHttpStatus": scan["httpStatus"],
            }
            opportunities.append(entry)
            known_urls.add(discovered["url"])
            key = (entry["company"].casefold(), entry["role"].casefold())
            if key not in previous_keys:
                changes.append({"type": "new", "message": f"Discovered official Hong Kong internship link: {entry['company']} - {entry['role']}"})

    watchlist = []
    opportunity_companies = {item.get("company", "").casefold() for item in opportunities}
    for scan in scans:
        if scan["company"].casefold() in opportunity_companies:
            continue
        watchlist.append({
            "company": scan["company"],
            "role": scan.get("segment", "Internship programme"),
            "category": scan["category"],
            "segment": scan.get("segment"),
            "sourceUrl": scan["sourceUrl"],
            "notes": scan.get("reason"),
            "priority": scan.get("priority", "Expanded"),
            "dateConfidence": "watchlist-unconfirmed",
            "lastVerified": scan["checkedAt"],
            "sourceReachable": scan["reachable"],
            "sourceHttpStatus": scan["httpStatus"],
            "pageTitle": scan["pageTitle"],
            "signals": scan["signals"],
            "scanError": scan["error"],
        })

    now = now_iso()
    closing_soon = 0
    for item in opportunities:
        value = item.get("closingDate")
        if value:
            try:
                days = (date.fromisoformat(value[:10]) - TODAY).days
                closing_soon += 0 <= days <= 30
            except ValueError:
                pass
    payload = {
        "generatedAt": now,
        "cycle": "Winter 2026-27 and Summer 2027",
        "coverage": {
            "companiesChecked": len(scans),
            "reachable": sum(bool(item["reachable"]) for item in scans),
            "unreachable": sum(not item["reachable"] for item in scans),
        },
        "summary": {
            "open": sum(str(item.get("applicationStatus", "")).startswith("Open") for item in opportunities),
            "upcoming": sum(item.get("applicationStatus") == "Upcoming" for item in opportunities),
            "closingSoon": closing_soon,
            "newSinceLastRun": sum(change["type"] == "new" for change in changes),
        },
        "opportunities": opportunities,
        "watchlist": watchlist,
        "changes": changes or [{"type": "checked", "message": f"Checked {len(scans)} official employer sources; no new confirmed links were detected."}],
    }
    write_json(RESULT_FILE, payload)
    write_json(STATUS_FILE, {
        "status": "complete",
        "startedAt": started,
        "completedAt": now,
        "message": f"Checked {len(scans)} companies; published {len(opportunities)} opportunities and {len(watchlist)} watchlist entries.",
    })
    print(json.dumps(payload["summary"], indent=2))


if __name__ == "__main__":
    main()
