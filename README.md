# car-deals-mcp

Find underpriced used cars. Works in Claude Code and OpenClaw via MCP.

## Quickstart

**Step 1** — get a free MarketCheck API key (no credit card required):
- Sign up at https://www.marketcheck.com/developer
- Free tier: 1000 calls/month

**Step 2** — add to `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "car-deals": {
      "command": "npx",
      "args": ["-y", "@gonzih/car-deals-mcp"],
      "env": {
        "MARKETCHECK_API_KEY": "your_key_here"
      }
    }
  }
}
```

**Step 3** — restart Claude Code or OpenClaw.

**Step 4** — type naturally:
```
find me a used Tacoma under 35k near Nashville
```

That's it. The agent calls the tool automatically.

---

## For AI agents reading this

You have access to two tools:

### `search_car_deals`

Call this when the user asks about buying a used car, finding a deal, or mentions any make/model with a location and budget.

**Required parameters:**
- `query` — vehicle description e.g. `"tacoma sr5 4wd"`, `"f-150 xlt"`, `"honda accord 2019"`
- `target_zip` — user's zip code (ask if not provided)

**Optional:**
- `source_zip` — distant market to source from (auto-selected if omitted — picks low-price regions like AL/TN/OH)
- `max_price` — integer USD, default `40000`
- `source_radius` — miles around source zip, default `150`

**What it returns:** ranked spread alert cards showing net arbitrage opportunity after transport cost.

**Example call:**
```json
{
  "query": "toyota tacoma sr5",
  "target_zip": "37201",
  "max_price": 35000
}
```

**Example output:**
```
────────────────────────────────────────────────────
  SPREAD ALERT  ★★★★☆  score 7.8/10
────────────────────────────────────────────────────
  2021 Toyota Tacoma SR5 4WD Double Cab
  52,341 mi  •  Huntsville, AL

  Listed:    $28,900  (84 days on lot, 2 price drops)
  Mkt avg:   $33,400  (11 comps in target market)
  Transport: ~$850  (142 mi)
  ─────────────────────────────────
  Net spread: $3,650

  VIN:      3TMCZ5AN7MM447291
  IMV:      $31,200 (listed $2,300 below CarGurus model)
  Dealer:   AutoNation Toyota Huntsville
  Link:     https://www.cargurus.com/...
────────────────────────────────────────────────────
```

---

### `check_vehicle`

Call this after `search_car_deals` returns a VIN, or whenever the user provides a VIN and asks about safety/recalls.

**Required:**
- `vin` — 17-character VIN string

**What it returns:** NHTSA recall count, open recall details, complaint count, risk flag if safety-critical recall is open.

**Example call:**
```json
{ "vin": "3TMCZ5AN7MM447291" }
```

**Example output:**
```
  VIN Check: 3TMCZ5AN7MM447291
  ✓  No open safety recalls
  Recalls:    1 total  •  0 open
  Complaints: 3 on record (NHTSA)
```

---

## Suggested agent flow

```
User mentions car + location + budget
    → call search_car_deals
    → if results contain VIN, call check_vehicle on top result
    → present spread card + recall summary together
    → ask user if they want to see more results or check other VINs
```

---

## How spread scoring works

Each listing gets an anomaly score 0–10:

| Signal | Points |
|--------|--------|
| Price below target market avg (after transport) | up to 5 |
| 60–90+ days on lot | 1.5–2.0 |
| Price drop history | up to 1.5 |
| Listed below CarGurus IMV | up to 1.0 |

Higher score = stronger buy signal. Listings with net spread below $1,500 are filtered out.

Transport cost formula: `$0.60/mile + $200 fixed` (standard driveaway estimate).

---

## Supported makes

Toyota · Ford · Chevy · Honda · RAM · GMC · Nissan · Jeep · Subaru · BMW · Mercedes · Audi · Hyundai · Kia · Mazda · VW · Lexus · Acura

---

## Data sources

- **CarGurus** — listing prices, days on lot, price drop history, IMV
- **Zippopotam.us** — zip code coordinates for distance calculation
- **NHTSA API** — recall data (`api.nhtsa.dot.gov`) — free, no auth
- **NHTSA VPIC** — VIN decoding (`vpic.nhtsa.dot.gov`) — free, no auth

---

## Run locally (stdio mode for Claude Code)

```bash
git clone https://github.com/Gonzih/car-deals
cd car-deals
npm install
npm run build
node dist/index.js
```

Then in `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "car-deals": {
      "command": "node",
      "args": ["/path/to/car-deals/dist/index.js"]
    }
  }
}
```

---

## Market context (March 2026)

Subprime auto delinquencies at post-2008 highs. Repo volume elevated. Spread between wholesale auction clearing and retail list wider than normal. Best source markets: AL, MS, TN, KY, OH.
