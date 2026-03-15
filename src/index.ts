#!/usr/bin/env node
/**
 * car-deals-mcp — MCP server for used car arbitrage
 *
 * Install in Claude Code (~/.claude/mcp.json):
 *   { "car-deals": { "command": "npx", "args": ["car-deals-mcp"] } }
 *
 * Install in OpenClaw:
 *   Name: car-deals
 *   Command: npx car-deals-mcp
 *
 * Then just type: "find me a used Tacoma under 35k near Nashville"
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findSpreads, defaultSourceZip } from "./spread.js";
import { checkVin } from "./nhtsa.js";

const server = new Server(
  { name: "car-deals", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_car_deals",
      description:
        "Find underpriced used cars by comparing prices across geographic markets. " +
        "Use when user asks to find a car, find a deal, or mentions make/model with location and budget.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Vehicle e.g. 'tacoma sr5 4wd', 'f-150 xlt', 'honda accord 2019'",
          },
          target_zip: {
            type: "string",
            description: "Your zip code — market you want to buy in or resell in",
          },
          source_zip: {
            type: "string",
            description: "Distant market to source from. Auto-selected if omitted.",
          },
          max_price: {
            type: "integer",
            description: "Maximum listing price in USD",
            default: 40000,
          },
          source_radius: {
            type: "integer",
            description: "Search radius in miles around source zip",
            default: 150,
          },
        },
        required: ["query", "target_zip"],
      },
    },
    {
      name: "check_vehicle",
      description:
        "Check a VIN for open NHTSA recalls, safety issues, and complaint history. " +
        "Use after finding a deal to verify the vehicle is clean before recommending purchase.",
      inputSchema: {
        type: "object",
        properties: {
          vin: {
            type: "string",
            description: "17-character Vehicle Identification Number",
          },
        },
        required: ["vin"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === "search_car_deals") {
    const query = String(args.query ?? "");
    const targetZip = String(args.target_zip ?? "");
    const sourceZip = String(args.source_zip ?? defaultSourceZip(targetZip));
    const maxPrice = Number(args.max_price ?? 40000);
    const sourceRadius = Number(args.source_radius ?? 150);

    if (!query || !targetZip) {
      return { content: [{ type: "text", text: "Need at least a vehicle query and your zip code." }] };
    }

    if (!process.env.MARKETCHECK_API_KEY) {
      return { content: [{ type: "text", text:
        "⚠️  MARKETCHECK_API_KEY not set.\n\n" +
        "Get a free key (1000 calls/month, no CC): https://www.marketcheck.com/developer\n\n" +
        "Then add to your mcp.json:\n" +
        '{\n  "car-deals": {\n    "command": "npx",\n    "args": ["-y", "@gonzih/car-deals-mcp"],\n    "env": { "MARKETCHECK_API_KEY": "your_key_here" }\n  }\n}'
      }] };
    }

    const results = await findSpreads(query, sourceZip, targetZip, maxPrice, sourceRadius);

    if (!results.length) {
      return {
        content: [{
          type: "text",
          text:
            `No spread opportunities found for '${query}' under $${maxPrice.toLocaleString()}.\n` +
            `Searched ${sourceZip} vs your market (${targetZip}).\n` +
            `Try widening radius, increasing budget, or a different source market.`,
        }],
      };
    }

    let output =
      `Found ${results.length} spread opportunit${results.length !== 1 ? "ies" : "y"} for '${query}':\n\n` +
      results.map((r) => r.summary).join("\n\n");

    const top = results[0];
    if (top.listing.vin) {
      output += `\n\nRun check_vehicle('${top.listing.vin}') to verify the top result is clean.`;
    }

    return { content: [{ type: "text", text: output }] };
  }

  if (name === "check_vehicle") {
    const vin = String(args.vin ?? "").trim().toUpperCase();
    if (vin.length !== 17) {
      return { content: [{ type: "text", text: `Invalid VIN: ${vin.length} chars, need 17.` }] };
    }
    const result = await checkVin(vin);
    return { content: [{ type: "text", text: result.summary }] };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("car-deals MCP server running");
}

main().catch(console.error);
