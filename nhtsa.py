"""
NHTSA recall + complaints wrapper.
Free public API: api.nhtsa.dot.gov
No auth required.
"""

import logging
from dataclasses import dataclass

import requests

logger = logging.getLogger(__name__)

BASE = "https://api.nhtsa.dot.gov"


@dataclass
class RecallSummary:
    vin: str
    recall_count: int
    open_recalls: list[dict]    # recalls not yet remedied
    complaint_count: int
    risk_flag: bool             # True if open safety-critical recall exists
    summary: str


def check_vin(vin: str) -> RecallSummary:
    """Full risk check for a VIN: recalls + complaint count."""
    recalls = _get_recalls(vin)
    complaints = _get_complaint_count(vin)

    open_recalls = [r for r in recalls if not r.get("RemedyDescription")]
    safety_critical = any(
        any(kw in (r.get("Component", "") + r.get("Summary", "")).upper()
            for kw in ("FUEL", "BRAKE", "STEER", "FIRE", "CRASH", "AIRBAG", "ROLLOVER"))
        for r in open_recalls
    )

    summary = _format_recall_summary(vin, recalls, open_recalls, complaints, safety_critical)

    return RecallSummary(
        vin=vin,
        recall_count=len(recalls),
        open_recalls=open_recalls,
        complaint_count=complaints,
        risk_flag=safety_critical,
        summary=summary,
    )


def _get_recalls(vin: str) -> list[dict]:
    try:
        resp = requests.get(
            f"{BASE}/vehicles/vin/{vin}/recalls",
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("results", [])
    except Exception as e:
        logger.debug(f"NHTSA recall fetch failed for {vin}: {e}")
    return []


def _get_complaint_count(vin: str) -> int:
    """
    NHTSA complaints are by year/make/model, not VIN.
    Decode VIN first to get year/make/model, then get complaint count.
    """
    decoded = _decode_vin(vin)
    if not decoded:
        return 0

    year = decoded.get("ModelYear", "")
    make = decoded.get("Make", "").upper()
    model = decoded.get("Model", "").upper()

    if not all([year, make, model]):
        return 0

    try:
        resp = requests.get(
            f"{BASE}/complaints/complaintsByVehicle?make={make}&model={model}&modelYear={year}",
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("count", 0)
    except Exception as e:
        logger.debug(f"NHTSA complaint fetch failed: {e}")
    return 0


def _decode_vin(vin: str) -> dict:
    try:
        resp = requests.get(
            f"https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json",
            timeout=10,
        )
        if resp.status_code == 200:
            results = resp.json().get("Results", [])
            return {r["Variable"]: r["Value"] for r in results if r.get("Value")}
    except Exception as e:
        logger.debug(f"VIN decode failed: {e}")
    return {}


def _format_recall_summary(
    vin: str,
    recalls: list[dict],
    open_recalls: list[dict],
    complaint_count: int,
    risk_flag: bool,
) -> str:
    flag = "⚠️  RISK FLAG — open safety recall" if risk_flag else "✓  No open safety recalls"

    lines = [
        f"  VIN Check: {vin}",
        f"  {flag}",
        f"  Recalls:    {len(recalls)} total  •  {len(open_recalls)} open",
        f"  Complaints: {complaint_count} on record (NHTSA)",
    ]

    if open_recalls:
        lines.append(f"  Open recall details:")
        for r in open_recalls[:3]:  # show max 3
            component = r.get("Component", "Unknown component")
            summary = r.get("Summary", "")[:80]
            lines.append(f"    • {component}: {summary}...")

    return "\n".join(lines)
