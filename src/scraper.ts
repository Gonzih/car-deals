import * as cheerio from "cheerio";

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

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const MAKE_SLUGS: Record<string, string> = {
  toyota: "d_toyota",
  ford: "d_ford",
  chevy: "d_chevrolet",
  chevrolet: "d_chevrolet",
  honda: "d_honda",
  ram: "d_ram",
  gmc: "d_gmc",
  nissan: "d_nissan",
  jeep: "d_jeep",
  subaru: "d_subaru",
  bmw: "d_bmw",
  mercedes: "d_mercedes_benz",
  audi: "d_audi",
  hyundai: "d_hyundai",
  kia: "d_kia",
  mazda: "d_mazda",
  volkswagen: "d_volkswagen",
  vw: "d_volkswagen",
  lexus: "d_lexus",
  acura: "d_acura",
};

function parsePrice(s: string): number | null {
  const clean = s.replace(/[^\d]/g, "");
  return clean ? parseInt(clean, 10) : null;
}

function parseQuery(query: string): [string, string] {
  const q = query.toLowerCase();
  for (const [make] of Object.entries(MAKE_SLUGS)) {
    if (q.includes(make)) {
      const modelHint = q.split(make).slice(1).join("").trim();
      return [make, modelHint];
    }
  }
  return ["", ""];
}

function buildUrl(make: string, zip: string, maxPrice: number, radius: number, maxMileage: number): string {
  const slug = MAKE_SLUGS[make] ?? `d_${make}`;
  return (
    `https://www.cargurus.com/Cars/new/nl/${slug}` +
    `?zip=${zip}&distance=${radius}&maxPrice=${maxPrice}` +
    `&maxMileage=${maxMileage}&listingTypes=USED&sortDir=ASC&sortType=PRICE`
  );
}

function parseListings(html: string, zipCode: string): Listing[] {
  const $ = cheerio.load(html);
  const listings: Listing[] = [];

  // Try JSON-LD first
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? "{}");
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Car" || item["@type"] === "Vehicle") {
          const offer = item.offers ?? {};
          const price = parsePrice(String(offer.price ?? ""));
          if (!price) continue;
          const seller = offer.seller ?? {};
          const address = seller.address ?? {};
          const mileageData = item.mileageFromOdometer ?? {};
          listings.push({
            title: item.name ?? "Unknown",
            price,
            mileage: parseInt(mileageData.value ?? "0", 10) || 0,
            daysOnLot: 0,
            priceDrops: 0,
            dealerName: seller.name ?? "Unknown Dealer",
            dealerCity: address.addressLocality ?? "",
            dealerState: address.addressRegion ?? "",
            vin: item.vehicleIdentificationNumber ?? null,
            url: item.url ?? "",
            imv: null,
            imvDelta: null,
            zipCode,
          });
        }
      }
    } catch {}
  });

  if (listings.length > 0) return listings;

  // Fallback: card parse
  $("[data-cg-ft='car-blade-link'], .cg-dealFinder-result").each((_, card) => {
    try {
      const priceEl = $(card).find("[data-cg-ft='car-blade-price'], .priceContainer").first();
      const price = parsePrice(priceEl.text());
      if (!price) return;

      const titleEl = $(card).find("[data-cg-ft='car-blade-title'], h4").first();
      const mileageEl = $(card).find("[data-cg-ft='car-blade-mileage']").first();
      const daysEl = $(card).find("[data-cg-ft='car-blade-days-listed']").first();
      const dropsEl = $(card).find("[data-cg-ft='price-drop-count']").first();
      const dealerEl = $(card).find("[data-cg-ft='car-blade-dealer-name']").first();
      const imvEl = $(card).find("[data-cg-ft='car-blade-imv']").first();
      const href = $(card).attr("href") ?? $(card).find("a").attr("href") ?? "";
      const vinMatch = $(card).html()?.match(/vin=([A-HJ-NPR-Z0-9]{17})/);

      const mileage = parseInt(mileageEl.text().replace(/[^\d]/g, "") || "0", 10);
      const daysOnLot = parseInt(daysEl.text().replace(/[^\d]/g, "") || "0", 10);
      const priceDrops = parseInt(dropsEl.text().replace(/[^\d]/g, "") || "0", 10);
      const imv = imvEl.length ? parsePrice(imvEl.text()) : null;

      const dealerText = dealerEl.text().trim();
      const [dealerName, locationRaw] = dealerText.split("•").map((s) => s.trim());
      const [dealerCity, dealerState] = (locationRaw ?? "").split(",").map((s) => s.trim());

      listings.push({
        title: titleEl.text().trim() || "Unknown",
        price,
        mileage,
        daysOnLot,
        priceDrops,
        dealerName: dealerName ?? "Unknown",
        dealerCity: dealerCity ?? "",
        dealerState: dealerState ?? "",
        vin: vinMatch ? vinMatch[1] : null,
        url: href.startsWith("/") ? `https://www.cargurus.com${href}` : href,
        imv,
        imvDelta: imv ? price - imv : null,
        zipCode,
      });
    } catch {}
  });

  return listings;
}

export async function search(
  query: string,
  zipCode: string,
  maxPrice = 50000,
  radius = 100,
  maxMileage = 150000,
  maxResults = 20
): Promise<Listing[]> {
  const [make, modelHint] = parseQuery(query);
  if (!make) return [];

  const url = buildUrl(make, zipCode, maxPrice, radius, maxMileage);

  let html: string;
  try {
    const { default: fetch } = await import("node-fetch");
    const res = await fetch(url, { headers: HEADERS });
    html = await res.text();
  } catch (e) {
    console.error("Fetch failed:", e);
    return [];
  }

  let listings = parseListings(html, zipCode);

  if (modelHint) {
    listings = listings.filter((l) => l.title.toLowerCase().includes(modelHint.toLowerCase()));
  }

  return listings.slice(0, maxResults);
}
