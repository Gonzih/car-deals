"""
CarGurus scraper — pulls listings for a given make/model/zip/budget.
Returns structured dicts with price, mileage, days_on_lot, price_drops, dealer, vin.
"""

import re
import json
import time
import random
import logging
from dataclasses import dataclass
from typing import Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# CarGurus make/model slug map — extend as needed
MAKE_SLUGS = {
    "toyota": "d_toyota",
    "ford": "d_ford",
    "chevy": "d_chevrolet",
    "chevrolet": "d_chevrolet",
    "honda": "d_honda",
    "ram": "d_ram",
    "gmc": "d_gmc",
    "nissan": "d_nissan",
    "jeep": "d_jeep",
    "subaru": "d_subaru",
    "bmw": "d_bmw",
    "mercedes": "d_mercedes_benz",
    "audi": "d_audi",
    "hyundai": "d_hyundai",
    "kia": "d_kia",
    "mazda": "d_mazda",
    "volkswagen": "d_volkswagen",
    "vw": "d_volkswagen",
    "lexus": "d_lexus",
    "acura": "d_acura",
}


@dataclass
class Listing:
    title: str
    price: int
    mileage: int
    days_on_lot: int
    price_drops: int
    dealer_name: str
    dealer_city: str
    dealer_state: str
    vin: Optional[str]
    url: str
    imv: Optional[int]          # CarGurus Instant Market Value
    imv_delta: Optional[int]    # price - imv (negative = below market)
    zip_code: str


def _parse_int(s: str) -> Optional[int]:
    """Extract first integer from a string."""
    m = re.search(r"[\d,]+", s.replace(",", ""))
    return int(m.group().replace(",", "")) if m else None


def _parse_price(text: str) -> Optional[int]:
    clean = re.sub(r"[^\d]", "", text)
    return int(clean) if clean else None


def search(
    query: str,
    zip_code: str,
    max_price: int = 50000,
    radius: int = 100,
    max_mileage: int = 150000,
    max_results: int = 20,
) -> list[Listing]:
    """
    Search CarGurus for listings matching a natural-language query.
    query examples: "tacoma sr5", "f-150 xlt 4wd", "honda accord 2019"
    """
    make, model_slug = _parse_query(query)
    if not make:
        logger.warning(f"Could not parse make from query: {query}")
        return []

    url = _build_url(make, zip_code, max_price, radius, max_mileage)
    logger.info(f"Fetching: {url}")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error(f"Fetch failed: {e}")
        return []

    listings = _parse_listings(resp.text, zip_code)

    # Filter by model keyword if provided
    if model_slug:
        listings = [l for l in listings if model_slug.lower() in l.title.lower()]

    return listings[:max_results]


def _parse_query(query: str) -> tuple[str, str]:
    """Return (make_key, model_hint) from natural language query."""
    query_lower = query.lower()
    for make, slug in MAKE_SLUGS.items():
        if make in query_lower:
            # everything after the make = model hint
            model_hint = query_lower.split(make, 1)[-1].strip()
            return make, model_hint
    return "", ""


def _build_url(make: str, zip_code: str, max_price: int, radius: int, max_mileage: int) -> str:
    slug = MAKE_SLUGS.get(make, f"d_{make}")
    return (
        f"https://www.cargurus.com/Cars/new/nl/{slug}"
        f"?zip={zip_code}"
        f"&distance={radius}"
        f"&maxPrice={max_price}"
        f"&maxMileage={max_mileage}"
        f"&listingTypes=USED"
        f"&sortDir=ASC"
        f"&sortType=PRICE"
    )


def _parse_listings(html: str, zip_code: str) -> list[Listing]:
    soup = BeautifulSoup(html, "html.parser")
    listings = []

    # CarGurus embeds listing data as JSON in a script tag
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string)
            if isinstance(data, list):
                for item in data:
                    l = _extract_listing(item, zip_code)
                    if l:
                        listings.append(l)
            elif isinstance(data, dict):
                l = _extract_listing(data, zip_code)
                if l:
                    listings.append(l)
        except (json.JSONDecodeError, AttributeError):
            continue

    # Fallback: parse visible listing cards
    if not listings:
        listings = _parse_listing_cards(soup, zip_code)

    return listings


def _extract_listing(item: dict, zip_code: str) -> Optional[Listing]:
    """Extract from JSON-LD Car schema."""
    if item.get("@type") not in ("Car", "Vehicle"):
        return None
    try:
        offer = item.get("offers", {})
        price = _parse_price(str(offer.get("price", "")))
        if not price:
            return None

        name = item.get("name", "Unknown")
        mileage_data = item.get("mileageFromOdometer", {})
        mileage = int(mileage_data.get("value", 0)) if mileage_data else 0

        seller = offer.get("seller", {})
        dealer_name = seller.get("name", "Unknown Dealer")
        address = seller.get("address", {})
        dealer_city = address.get("addressLocality", "")
        dealer_state = address.get("addressRegion", "")

        vin = item.get("vehicleIdentificationNumber")
        url = item.get("url", "")

        return Listing(
            title=name,
            price=price,
            mileage=mileage,
            days_on_lot=0,       # not in JSON-LD, filled by card parse
            price_drops=0,
            dealer_name=dealer_name,
            dealer_city=dealer_city,
            dealer_state=dealer_state,
            vin=vin,
            url=url,
            imv=None,
            imv_delta=None,
            zip_code=zip_code,
        )
    except (KeyError, ValueError, TypeError):
        return None


def _parse_listing_cards(soup: BeautifulSoup, zip_code: str) -> list[Listing]:
    """
    Fallback HTML card parser.
    CarGurus listing cards have consistent class patterns.
    """
    listings = []
    cards = soup.select("[data-cg-ft='car-blade-link']") or soup.select(".cg-dealFinder-result")

    for card in cards:
        try:
            title_el = card.select_one("[data-cg-ft='car-blade-title']") or card.select_one("h4")
            price_el = card.select_one("[data-cg-ft='car-blade-price']") or card.select_one(".priceContainer")
            mileage_el = card.select_one("[data-cg-ft='car-blade-mileage']")
            days_el = card.select_one("[data-cg-ft='car-blade-days-listed']")
            drops_el = card.select_one("[data-cg-ft='price-drop-count']")
            dealer_el = card.select_one("[data-cg-ft='car-blade-dealer-name']")
            imv_el = card.select_one("[data-cg-ft='car-blade-imv']")
            url_el = card.get("href") or (card.select_one("a") or {}).get("href", "")
            vin_match = re.search(r"vin=([A-HJ-NPR-Z0-9]{17})", str(card))

            price = _parse_price(price_el.get_text()) if price_el else None
            if not price:
                continue

            mileage = _parse_int(mileage_el.get_text()) if mileage_el else 0
            days = _parse_int(days_el.get_text()) if days_el else 0
            drops = _parse_int(drops_el.get_text()) if drops_el else 0
            imv = _parse_price(imv_el.get_text()) if imv_el else None

            dealer_text = dealer_el.get_text(strip=True) if dealer_el else "Unknown"
            # "Dealer Name • City, ST"
            dealer_parts = dealer_text.split("•")
            dealer_name = dealer_parts[0].strip()
            location = dealer_parts[1].strip() if len(dealer_parts) > 1 else ""
            loc_parts = location.split(",")
            dealer_city = loc_parts[0].strip() if loc_parts else ""
            dealer_state = loc_parts[1].strip() if len(loc_parts) > 1 else ""

            listings.append(Listing(
                title=title_el.get_text(strip=True) if title_el else "Unknown",
                price=price,
                mileage=mileage or 0,
                days_on_lot=days or 0,
                price_drops=drops or 0,
                dealer_name=dealer_name,
                dealer_city=dealer_city,
                dealer_state=dealer_state,
                vin=vin_match.group(1) if vin_match else None,
                url=f"https://www.cargurus.com{url_el}" if url_el.startswith("/") else url_el,
                imv=imv,
                imv_delta=(price - imv) if (price and imv) else None,
                zip_code=zip_code,
            ))
        except Exception as e:
            logger.debug(f"Card parse error: {e}")
            continue

    return listings


def _sleep():
    time.sleep(random.uniform(1.0, 2.5))
