"""
Spread calculator — compares listings across two markets, scores anomalies.
Transport cost estimate: $0.60/mile + $200 fixed (standard driveaway estimate).
"""

import math
import logging
from dataclasses import dataclass
from typing import Optional

import requests

from scraper import Listing, search

logger = logging.getLogger(__name__)


# Zip code → (lat, lon) via free zippopotam.us API
_ZIP_CACHE: dict[str, tuple[float, float]] = {}


@dataclass
class SpreadResult:
    listing: Listing
    source_market_zip: str
    target_market_zip: str
    target_avg_price: int
    comparable_count: int
    transport_cost: int
    distance_miles: int
    net_spread: int             # target_avg - listing.price - transport_cost
    anomaly_score: float        # 0-10, higher = better deal
    summary: str                # human-readable card


def find_spreads(
    query: str,
    source_zip: str,
    target_zip: str,
    max_price: int = 50000,
    source_radius: int = 200,
    target_radius: int = 100,
    min_net_spread: int = 1500,
    max_results: int = 5,
) -> list[SpreadResult]:
    """
    Find listings in source_zip market that are underpriced vs target_zip market.
    Returns top anomalies ranked by net spread.
    """
    logger.info(f"Searching source market {source_zip}...")
    source_listings = search(query, source_zip, max_price=max_price, radius=source_radius)

    logger.info(f"Searching target market {target_zip} for comparables...")
    target_listings = search(query, target_zip, max_price=max_price * 2, radius=target_radius)

    if not source_listings:
        logger.warning("No source listings found.")
        return []

    if not target_listings:
        logger.warning("No target listings found — cannot calculate spread.")
        return []

    target_avg = _average_price(target_listings)
    distance = _zip_distance(source_zip, target_zip)
    transport = _transport_cost(distance)

    results = []
    for listing in source_listings:
        net = target_avg - listing.price - transport
        if net < min_net_spread:
            continue

        score = _anomaly_score(listing, target_avg, transport, target_listings)
        summary = _format_card(listing, target_avg, len(target_listings), transport, distance, net, score)

        results.append(SpreadResult(
            listing=listing,
            source_market_zip=source_zip,
            target_market_zip=target_zip,
            target_avg_price=target_avg,
            comparable_count=len(target_listings),
            transport_cost=transport,
            distance_miles=distance,
            net_spread=net,
            anomaly_score=score,
            summary=summary,
        ))

    results.sort(key=lambda r: r.net_spread, reverse=True)
    return results[:max_results]


def _average_price(listings: list[Listing]) -> int:
    if not listings:
        return 0
    return int(sum(l.price for l in listings) / len(listings))


def _zip_distance(zip1: str, zip2: str) -> int:
    """Straight-line distance in miles between two zip codes."""
    c1 = _zip_coords(zip1)
    c2 = _zip_coords(zip2)
    if not c1 or not c2:
        return 300  # fallback estimate
    return int(_haversine(c1[0], c1[1], c2[0], c2[1]))


def _zip_coords(zip_code: str) -> Optional[tuple[float, float]]:
    if zip_code in _ZIP_CACHE:
        return _ZIP_CACHE[zip_code]
    try:
        resp = requests.get(
            f"https://api.zippopotam.us/us/{zip_code}",
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            place = data["places"][0]
            coords = (float(place["latitude"]), float(place["longitude"]))
            _ZIP_CACHE[zip_code] = coords
            return coords
    except Exception as e:
        logger.debug(f"Zip lookup failed for {zip_code}: {e}")
    return None


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.8  # Earth radius miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _transport_cost(miles: int) -> int:
    """Driveaway transport estimate: $0.60/mile + $200 fixed."""
    return int(miles * 0.60 + 200)


def _anomaly_score(
    listing: Listing,
    target_avg: int,
    transport: int,
    comparables: list[Listing],
) -> float:
    """
    Score 0-10. Combines:
    - Price discount vs target avg (50%)
    - Days on lot pressure (20%)
    - Price drop history (20%)
    - IMV delta if available (10%)
    """
    if not comparables or target_avg == 0:
        return 0.0

    # Price discount component
    discount_pct = (target_avg - listing.price - transport) / target_avg
    price_score = min(discount_pct * 40, 5.0)  # cap at 5 pts

    # Days on lot (>60 days = seller pressure)
    if listing.days_on_lot >= 90:
        lot_score = 2.0
    elif listing.days_on_lot >= 60:
        lot_score = 1.5
    elif listing.days_on_lot >= 30:
        lot_score = 1.0
    else:
        lot_score = 0.0

    # Price drops
    drop_score = min(listing.price_drops * 0.5, 1.5)

    # IMV delta
    if listing.imv_delta is not None and listing.imv_delta < 0:
        imv_score = min(abs(listing.imv_delta) / 1000, 1.0)
    else:
        imv_score = 0.0

    return round(min(price_score + lot_score + drop_score + imv_score, 10.0), 1)


def _format_card(
    listing: Listing,
    target_avg: int,
    comparable_count: int,
    transport: int,
    distance: int,
    net_spread: int,
    score: float,
) -> str:
    stars = "★" * int(score / 2) + "☆" * (5 - int(score / 2))
    vin_line = f"VIN:      {listing.vin}" if listing.vin else ""
    imv_line = (
        f"IMV:      ${listing.imv:,} (listed ${abs(listing.imv_delta):,} "
        f"{'below' if listing.imv_delta < 0 else 'above'} CarGurus model)"
        if listing.imv and listing.imv_delta is not None
        else ""
    )
    lot_line = f"{listing.days_on_lot} days on lot" if listing.days_on_lot else "days on lot unknown"
    drops_line = f", {listing.price_drops} price drop{'s' if listing.price_drops != 1 else ''}" if listing.price_drops else ""

    lines = [
        f"{'─'*52}",
        f"  SPREAD ALERT  {stars}  score {score}/10",
        f"{'─'*52}",
        f"  {listing.title}",
        f"  {listing.mileage:,} mi  •  {listing.dealer_city}, {listing.dealer_state}",
        f"",
        f"  Listed:    ${listing.price:,}  ({lot_line}{drops_line})",
        f"  Mkt avg:   ${target_avg:,}  ({comparable_count} comps in target market)",
        f"  Transport: ~${transport:,}  ({distance} mi)",
        f"  ─────────────────────────────────",
        f"  Net spread: ${net_spread:,}",
        f"",
    ]

    if vin_line:
        lines.append(f"  {vin_line}")
    if imv_line:
        lines.append(f"  {imv_line}")

    lines += [
        f"  Dealer:   {listing.dealer_name}",
        f"  Link:     {listing.url}",
        f"{'─'*52}",
    ]

    return "\n".join(l for l in lines if l is not None)
