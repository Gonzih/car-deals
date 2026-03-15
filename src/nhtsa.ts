export interface RecallSummary {
  vin: string;
  recallCount: number;
  openRecalls: Record<string, unknown>[];
  complaintCount: number;
  riskFlag: boolean;
  summary: string;
}

const BASE = "https://api.nhtsa.dot.gov";
const VPIC = "https://vpic.nhtsa.dot.gov/api";

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const { default: fetch } = await import("node-fetch");
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) return (await res.json()) as T;
  } catch {}
  return null;
}

async function getRecalls(vin: string): Promise<Record<string, unknown>[]> {
  const data = await fetchJson<{ results: Record<string, unknown>[] }>(
    `${BASE}/vehicles/vin/${vin}/recalls`
  );
  return data?.results ?? [];
}

async function decodeVin(vin: string): Promise<Record<string, string>> {
  const data = await fetchJson<{ Results: Array<{ Variable: string; Value: string }> }>(
    `${VPIC}/vehicles/DecodeVin/${vin}?format=json`
  );
  if (!data) return {};
  return Object.fromEntries(
    data.Results.filter((r) => r.Value).map((r) => [r.Variable, r.Value])
  );
}

async function getComplaintCount(vin: string): Promise<number> {
  const decoded = await decodeVin(vin);
  const year = decoded["ModelYear"];
  const make = decoded["Make"]?.toUpperCase();
  const model = decoded["Model"]?.toUpperCase();
  if (!year || !make || !model) return 0;

  const data = await fetchJson<{ count: number }>(
    `${BASE}/complaints/complaintsByVehicle?make=${make}&model=${model}&modelYear=${year}`
  );
  return data?.count ?? 0;
}

function isSafetyCritical(recall: Record<string, unknown>): boolean {
  const text = `${recall["Component"] ?? ""} ${recall["Summary"] ?? ""}`.toUpperCase();
  return ["FUEL", "BRAKE", "STEER", "FIRE", "CRASH", "AIRBAG", "ROLLOVER"].some((kw) =>
    text.includes(kw)
  );
}

function formatSummary(
  vin: string,
  recalls: Record<string, unknown>[],
  openRecalls: Record<string, unknown>[],
  complaintCount: number,
  riskFlag: boolean
): string {
  const flag = riskFlag
    ? "⚠️  RISK FLAG — open safety recall"
    : "✓  No open safety recalls";

  const lines = [
    `  VIN Check: ${vin}`,
    `  ${flag}`,
    `  Recalls:    ${recalls.length} total  •  ${openRecalls.length} open`,
    `  Complaints: ${complaintCount} on record (NHTSA)`,
  ];

  if (openRecalls.length) {
    lines.push("  Open recall details:");
    for (const r of openRecalls.slice(0, 3)) {
      const component = (r["Component"] as string) ?? "Unknown component";
      const summary = ((r["Summary"] as string) ?? "").slice(0, 80);
      lines.push(`    • ${component}: ${summary}...`);
    }
  }

  return lines.join("\n");
}

export async function checkVin(vin: string): Promise<RecallSummary> {
  const [recalls, complaintCount] = await Promise.all([
    getRecalls(vin),
    getComplaintCount(vin),
  ]);

  const openRecalls = recalls.filter((r) => !r["RemedyDescription"]);
  const riskFlag = openRecalls.some(isSafetyCritical);
  const summary = formatSummary(vin, recalls, openRecalls, complaintCount, riskFlag);

  return { vin, recallCount: recalls.length, openRecalls, complaintCount, riskFlag, summary };
}
