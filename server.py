"""
car-deals MCP server
Exposes two tools to Claude/OpenClaw:
  - search_car_deals(query, location, budget)
  - check_vehicle(vin)

Usage:
  python server.py
  or via mcp run server.py

Configure in Claude Code ~/.claude/mcp.json:
  {
    "car-deals": {
      "command": "python",
      "args": ["/path/to/car-deals/server.py"]
    }
  }
"""

import logging
import sys

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
import mcp.types as types

from spread import find_spreads
from nhtsa import check_vin

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger(__name__)

app = Server("car-deals")


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="search_car_deals",
            description=(
                "Find underpriced used cars by comparing prices across geographic markets. "
                "Searches for listings in a source market and compares against a target market "
                "to identify price spread anomalies worth arbitraging. "
                "Use when user asks to find a car, find a deal, find underpriced vehicles, "
                "or mentions a specific make/model with a location and budget."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Vehicle description e.g. 'tacoma sr5 4wd', 'f-150 xlt', 'honda accord 2019-2021'",
                    },
                    "target_zip": {
                        "type": "string",
                        "description": "Your zip code — the market you want to buy in / resell in",
                    },
                    "source_zip": {
                        "type": "string",
                        "description": "Distant market zip to search for underpriced inventory. If not provided, agent picks a likely low-price region.",
                    },
                    "max_price": {
                        "type": "integer",
                        "description": "Maximum listing price in USD",
                        "default": 40000,
                    },
                    "source_radius": {
                        "type": "integer",
                        "description": "Search radius in miles around source zip",
                        "default": 150,
                    },
                },
                "required": ["query", "target_zip"],
            },
        ),
        Tool(
            name="check_vehicle",
            description=(
                "Check a vehicle VIN for open NHTSA recalls, safety issues, and complaint history. "
                "Use after finding a deal to verify the vehicle is clean before recommending purchase."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "vin": {
                        "type": "string",
                        "description": "17-character Vehicle Identification Number",
                    },
                },
                "required": ["vin"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "search_car_deals":
        return await _handle_search(arguments)
    elif name == "check_vehicle":
        return await _handle_check(arguments)
    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def _handle_search(args: dict) -> list[TextContent]:
    query = args.get("query", "")
    target_zip = args.get("target_zip", "")
    source_zip = args.get("source_zip") or _default_source_zip(target_zip)
    max_price = int(args.get("max_price", 40000))
    source_radius = int(args.get("source_radius", 150))

    if not query or not target_zip:
        return [TextContent(type="text", text="Need at least a vehicle query and your zip code.")]

    logger.info(f"search_car_deals: {query} | target={target_zip} source={source_zip} max=${max_price}")

    results = find_spreads(
        query=query,
        source_zip=source_zip,
        target_zip=target_zip,
        max_price=max_price,
        source_radius=source_radius,
    )

    if not results:
        return [TextContent(
            type="text",
            text=(
                f"No spread opportunities found for '{query}' under ${max_price:,}.\n"
                f"Searched {source_zip} area vs your market ({target_zip}).\n"
                f"Try widening the radius, increasing budget, or a different source market."
            ),
        )]

    cards = [r.summary for r in results]
    header = f"Found {len(results)} spread opportunity{'s' if len(results) != 1 else ''} for '{query}':\n"
    output = header + "\n\n".join(cards)

    # Append VIN check nudge for top result
    top = results[0]
    if top.listing.vin:
        output += f"\n\nRun check_vehicle('{top.listing.vin}') to verify the top result is clean."

    return [TextContent(type="text", text=output)]


async def _handle_check(args: dict) -> list[TextContent]:
    vin = args.get("vin", "").strip().upper()

    if len(vin) != 17:
        return [TextContent(type="text", text=f"Invalid VIN length: {len(vin)} chars. VINs are 17 characters.")]

    logger.info(f"check_vehicle: {vin}")

    result = check_vin(vin)
    return [TextContent(type="text", text=result.summary)]


def _default_source_zip(target_zip: str) -> str:
    """
    Pick a default low-price source market based on target region.
    Rough heuristic: southeast/midwest tend to have lower used car prices.
    In production: make this smarter with market data.
    """
    # Northeast → try Southeast
    northeast = {"0", "1"}
    if target_zip and target_zip[0] in northeast:
        return "35801"  # Huntsville AL

    # West Coast → try Midwest
    west = {"9"}
    if target_zip and target_zip[0] in west:
        return "64101"  # Kansas City MO

    # Default: Birmingham AL — historically low used car prices
    return "35203"


if __name__ == "__main__":
    import asyncio
    asyncio.run(stdio_server(app))
