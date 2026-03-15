# car-deals — MCP server for used car arbitrage

Natural language → spread alert card. Works in Claude Code and OpenClaw.

## The demo

Type this in OpenClaw or Claude Code:

```
find me a used Tacoma under 35k within 200 miles of Nashville
```

Get this back:

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
  → scrapes CarGurus for listings in source market
  → calculates avg price for same spec in target market
  → subtracts transport cost estimate
  → ranks by net spread + anomaly score
  → returns spread alert cards

check_vehicle(vin)
  → NHTSA recall check (free public API)
  → complaint count by year/make/model
  → risk flag if open safety recall exists
```

## Anomaly score factors

- Price discount vs target market avg (50%)
- Days on lot — >60 days = seller pressure (20%)
- Price drop count (20%)
- CarGurus IMV delta if available (10%)

## Install

```bash
pip install -r requirements.txt
```

## Add to Claude Code

`~/.claude/mcp.json`:

```json
{
  "car-deals": {
    "command": "python",
    "args": ["/Users/feral/money-brain/car-deals/server.py"]
  }
}
```

## Add to OpenClaw

In OpenClaw settings → MCP Servers → Add:

```
Name: car-deals
Command: python /Users/feral/money-brain/car-deals/server.py
```

## Current liquidation window (March 2026)

Subprime auto delinquencies at post-2008 highs. Repos flowing. Copart volume elevated.
Spread between wholesale auction clearing and retail list wider than normal.
Best markets to source from: AL, MS, TN, KY, OH — lower retail competition, motivated dealers.

## Files

```
server.py       MCP server — exposes search_car_deals + check_vehicle tools
scraper.py      CarGurus listing scraper
spread.py       Spread calculator + anomaly scoring + card formatter
nhtsa.py        NHTSA recall + complaint wrapper
requirements.txt
```
