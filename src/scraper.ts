/**
 * Car listing scraper
 *
 * Data source priority:
 * 1. MarketCheck API (free tier, requires MARKETCHECK_API_KEY env var)
 *    Sign up free: https://www.marketcheck.com/developer
 * 2. Graceful fallback with clear error message
 *
 * MarketCheck free tier: 1000 calls/month, no CC required.
 */

export interface Listing {
  title: string;
  price: number;
  mileage: number;
  daysOnLot: number;
  priceDrops: number;
  dealerName: string;
  dealerCity: string;
  dealerState: string;
  vin: string | null;
  url: string;
  imv: number | null;
  imvDelta: number | null;
  zipCode: string;
}

const MC_BASE = "https://api.marketcheck.com/v2";

export async function search(
  query: string,
  zipCode: string,
  maxPrice = 50000,
  radius = 100,
  maxMileage = 150000,
  maxResults = 20
): Promise<Listing[]> {
  const apiKey = process.env.MARKETCHECK_API_KEY;

  if (!apiKey) {
    console.error(
      "[car-deals] No MARKETCHECK_API_KEY set. " +
      "Get a free key at https://www.marketcheck.com/developer — " +
      "1000 calls/month, no credit card required."
    );
    return [];
  }

  const [make, model] = parseQuery(query);
  if (!make) {
    console.error(`[car-deals] Could not parse make from query: ${query}`);
    return [];
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    zip: zipCode,
    radius: String(radius),
    car_type: "used",
    make,
    ...(model ? { model } : {}),
    price_range: `0-${maxPrice}`,
    rows: String(Math.min(maxResults, 50)),
    start: "0",
    sort_by: "price",
    sort_order: "asc",
    include_extra: "dom",
  });

  const url = `${MC_BASE}/search/car/active?${params}`;
  console.error(`[car-deals] Fetching: ${url.replace(apiKey, "***")}`);

  try {
    const { default: fetch } = await import("node-fetch");
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[car-deals] MarketCheck API error ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }

    const data = (await res.json()) as { listings?: MCListing[] };
    return (data.listings ?? []).map(l => mcToListing(l, zipCode));
  } catch (e) {
    console.error("[car-deals] Fetch error:", e);
    return [];
  }
}

interface MCListing {
  id: string;
  vin?: string;
  price: number;
  miles?: number;
  dom?: number;           // days on market
  dom_180?: number;
  heading?: string;
  dealer?: {
    name?: string;
    city?: string;
    state?: string;
  };
  vdp_url?: string;
  inventory_type?: string;
}

function mcToListing(l: MCListing, zipCode: string): Listing {
  return {
    title: l.heading ?? "Unknown",
    price: l.price ?? 0,
    mileage: l.miles ?? 0,
    daysOnLot: l.dom ?? 0,
    priceDrops: 0,   // MarketCheck free tier doesn't expose price drop count
    dealerName: l.dealer?.name ?? "Unknown Dealer",
    dealerCity: l.dealer?.city ?? "",
    dealerState: l.dealer?.state ?? "",
    vin: l.vin ?? null,
    url: l.vdp_url ?? "",
    imv: null,
    imvDelta: null,
    zipCode,
  };
}

const MAKE_MAP: Record<string, [string, string]> = {
  // [query keyword]: [MarketCheck make, model hint]
  "toyota": ["Toyota", ""],
  "tacoma": ["Toyota", "Tacoma"],
  "tundra": ["Toyota", "Tundra"],
  "f-150": ["Ford", "F-150"],
  "f150": ["Ford", "F-150"],
  "f-250": ["Ford", "F-250"],
  "ford": ["Ford", ""],
  "silverado": ["Chevrolet", "Silverado"],
  "colorado": ["Chevrolet", "Colorado"],
  "chevy": ["Chevrolet", ""],
  "chevrolet": ["Chevrolet", ""],
  "honda": ["Honda", ""],
  "accord": ["Honda", "Accord"],
  "civic": ["Honda", "Civic"],
  "cr-v": ["Honda", "CR-V"],
  "ram": ["Ram", ""],
  "gmc": ["GMC", ""],
  "sierra": ["GMC", "Sierra"],
  "nissan": ["Nissan", ""],
  "frontier": ["Nissan", "Frontier"],
  "jeep": ["Jeep", ""],
  "wrangler": ["Jeep", "Wrangler"],
  "subaru": ["Subaru", ""],
  "outback": ["Subaru", "Outback"],
  "bmw": ["BMW", ""],
  "mercedes": ["Mercedes-Benz", ""],
  "audi": ["Audi", ""],
  "hyundai": ["Hyundai", ""],
  "kia": ["Kia", ""],
  "mazda": ["Mazda", ""],
  "volkswagen": ["Volkswagen", ""],
  "vw": ["Volkswagen", ""],
  "lexus": ["Lexus", ""],
  "acura": ["Acura", ""],
};

function parseQuery(query: string): [string, string] {
  const q = query.toLowerCase();
  // Longest match first (e.g. "tacoma" before "toyota")
  const keys = Object.keys(MAKE_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (q.includes(key)) {
      return MAKE_MAP[key];
    }
  }
  // Generic fallback: first word = make
  const word = q.split(/\s+/)[0];
  return [word.charAt(0).toUpperCase() + word.slice(1), ""];
}
