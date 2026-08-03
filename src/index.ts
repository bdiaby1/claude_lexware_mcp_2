import { loadConfig } from "./config.js";
import { createApp } from "./server.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(`Rana Lexware MCP server listening on port ${config.port} (POST /mcp)`);
});
