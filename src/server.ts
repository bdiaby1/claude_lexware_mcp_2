import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { LexwareClient } from "./lexware/client.js";
import { registerTools } from "./tools.js";

function buildMcpServer(lexware: LexwareClient): McpServer {
  const server = new McpServer({ name: "rana-lexware-mcp", version: "1.0.0" });
  registerTools(server, lexware);
  return server;
}

export function createApp(config: Config) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  const lexware = new LexwareClient({ apiKey: config.lexwareApiKey, baseUrl: config.lexwareApiBaseUrl });

  app.use((req, res, next) => {
    const header = req.header("authorization") ?? "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (token !== config.mcpAuthToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // Stateless: a fresh MCP server + transport per request, matching the
  // streamable-HTTP transport's documented stateless usage pattern.
  app.post("/mcp", async (req, res) => {
    const server = buildMcpServer(lexware);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
