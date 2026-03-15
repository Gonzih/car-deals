# car-deals-mcp

MCP server for used car arbitrage. Natural language → spread alert card.

Works in **Claude Code** and **OpenClaw**. Zero install beyond the config line.

## Install

**Claude Code** — add to `~/.claude/mcp.json`:
```json
{
  "car-deals": {
    "command": "npx",
    "args": ["car-deals-mcp"]
  }
}
```

**OpenClaw** — Settings → MCP Servers → Add:
```
Name: car-deals
Command: npx car-deals-mcp
```

## Usage

Just type naturally:

```
find me a used Tacoma under 35k near Nashville
```

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

Run check_vehicle('3TMCZ5AN7MM447291') to verify the top result is clean.
```

Then chain it:

```
check the VIN on the top result
```

```
  VIN Check: 3TMCZ5AN7MM447291
  ✓  No open safety recalls
  Recalls:    1 total  •  0 open
  Complaints: 3 on record (NHTSA)
```

## How it works

```
search_car_deals(query, target_zip, source_zip?, max_price?)
  → scrapes CarGurus for listings in a low-price source market
  → calculates avg price for same spec in your target market
  → subtracts transport cost estimate ($0.60/mi + $200)
  → ranks by net spread + anomaly score
  → returns spread alert cards

check_vehicle(vin)
  → NHTSA recall check (free public API)
  → complaint count by year/make/model
  → risk flag if open safety recall exists
```

## Anomaly score (0–10)

| Factor | Weight |
|--------|--------|
| Price discount vs target market avg | 50% |
| Days on lot (>60 days = seller pressure) | 20% |
| Price drop count | 20% |
| CarGurus IMV delta | 10% |

## Supported makes

Toyota, Ford, Chevy, Honda, RAM, GMC, Nissan, Jeep, Subaru, BMW, Mercedes, Audi, Hyundai, Kia, Mazda, VW, Lexus, Acura

## Why now

Subprime auto delinquencies at post-2008 highs. Repos flowing into auction. The spread between wholesale clearing and retail list is wider than normal. 12–18 month window.

Best source markets: AL, MS, TN, KY, OH — lower retail competition, motivated dealers.
