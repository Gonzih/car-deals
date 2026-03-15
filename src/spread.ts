import { search, Listing } from "./scraper.js";

export interface SpreadResult {
  listing: Listing;
  sourceMarketZip: string;
  targetMarketZip: string;
  targetAvgPrice: number;
  comparableCount: number;
  transportCost: number;
  distanceMiles: number;
  netSpread: number;
  anomalyScore: number;
  summary: string;
}

const ZIP_CACHE = new Map<string, [number, number]>();

async function zipCoords(zip: string): Promise<[number, number] | null> {
  if (ZIP_CACHE.has(zip)) return ZIP_CACHE.get(zip)!;
  try {
    const { default: fetch } = await import("node-fetch");
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (res.ok) {
      const data = (await res.json()) as { places: Array<{ latitude: string; longitude: string }> };
      const place = data.places[0];
      const coords: [number, number] = [parseFloat(place.latitude), parseFloat(place.longitude)];
      ZIP_CACHE.set(zip, coords);
      return coords;
    }
  } catch {}
  return null;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function zipDistance(zip1: string, zip2: string): Promise<number> {
  const c1 = await zipCoords(zip1);
  const c2 = await zipCoords(zip2);
  if (!c1 || !c2) return 300;
  return Math.round(haversine(c1[0], c1[1], c2[0], c2[1]));
}

function transportCost(miles: number): number {
  return Math.round(miles * 0.6 + 200);
}

function avgPrice(listings: Listing[]): number {
  if (!listings.length) return 0;
  return Math.round(listings.reduce((s, l) => s + l.price, 0) / listings.length);
}

function anomalyScore(listing: Listing, targetAvg: number, transport: number): number {
  if (!targetAvg) return 0;

  const discountPct = (targetAvg - listing.price - transport) / targetAvg;
  const priceScore = Math.min(discountPct * 40, 5.0);

  const lotScore =
    listing.daysOnLot >= 90 ? 2.0 :
    listing.daysOnLot >= 60 ? 1.5 :
    listing.daysOnLot >= 30 ? 1.0 : 0.0;

  const dropScore = Math.min(listing.priceDrops * 0.5, 1.5);

  const imvScore =
    listing.imvDelta !== null && listing.imvDelta < 0
      ? Math.min(Math.abs(listing.imvDelta) / 1000, 1.0)
      : 0.0;

  return Math.round(Math.min(priceScore + lotScore + dropScore + imvScore, 10.0) * 10) / 10;
}

function formatCard(
  listing: Listing,
  targetAvg: number,
  comparableCount: number,
  transport: number,
  distance: number,
  netSpread: number,
  score: number
): string {
  const line = "=".repeat(52);

  const lotLine = listing.daysOnLot
    ? `${listing.daysOnLot} days on lot${listing.priceDrops ? `, ${listing.priceDrops} price drop${listing.priceDrops !== 1 ? "s" : ""}` : ""}`
    : "days on lot unknown";

  const imvLine =
    listing.imv && listing.imvDelta !== null
      ? `IMV:      $${listing.imv.toLocaleString()} (listed $${Math.abs(listing.imvDelta).toLocaleString()} ${listing.imvDelta < 0 ? "below" : "above"} market)`
      : null;

  const lines = [
    line,
    `SPREAD ALERT  score ${score}/10`,
    line,
    listing.title,
    `${listing.mileage.toLocaleString()} mi  |  ${listing.dealerCity}, ${listing.dealerState}`,
    "",
    `Listed:    $${listing.price.toLocaleString()}  (${lotLine})`,
    `Mkt avg:   $${targetAvg.toLocaleString()}  (${comparableCount} comps in target market)`,
    `Transport: ~$${transport.toLocaleString()}  (${distance} mi)`,
    "-".repeat(33),
    `Net spread: $${netSpread.toLocaleString()}`,
    "",
    ...(listing.vin ? [`VIN:    ${listing.vin}`] : []),
    ...(imvLine ? [imvLine] : []),
    `Dealer: ${listing.dealerName}`,
    ...(listing.url ? [`Link:   ${listing.url}`] : []),
    line,
  ];

  return lines.join("\n");
}

export async function findSpreads(
  query: string,
  sourceZip: string,
  targetZip: string,
  maxPrice = 50000,
  sourceRadius = 100,
  targetRadius = 100,
  minNetSpread = 1500,
  maxResults = 5
): Promise<SpreadResult[]> {
  const [sourceListings, targetListings] = await Promise.all([
    search(query, sourceZip, maxPrice, sourceRadius),
    search(query, targetZip, maxPrice * 2, targetRadius),
  ]);

  if (!sourceListings.length || !targetListings.length) return [];

  const targetAvg = avgPrice(targetListings);
  const distance = await zipDistance(sourceZip, targetZip);
  const transport = transportCost(distance);

  const results: SpreadResult[] = [];

  for (const listing of sourceListings) {
    const net = targetAvg - listing.price - transport;
    if (net < minNetSpread) continue;

    const score = anomalyScore(listing, targetAvg, transport);
    const summary = formatCard(listing, targetAvg, targetListings.length, transport, distance, net, score);

    results.push({
      listing,
      sourceMarketZip: sourceZip,
      targetMarketZip: targetZip,
      targetAvgPrice: targetAvg,
      comparableCount: targetListings.length,
      transportCost: transport,
      distanceMiles: distance,
      netSpread: net,
      anomalyScore: score,
      summary,
    });
  }

  return results.sort((a, b) => b.netSpread - a.netSpread).slice(0, maxResults);
}

export function defaultSourceZip(targetZip: string): string {
  if (targetZip[0] === "0" || targetZip[0] === "1") return "35801"; // Northeast → Huntsville AL
  if (targetZip[0] === "9") return "64101";                          // West Coast → Kansas City MO
  return "35203";                                                     // Default: Birmingham AL
}
