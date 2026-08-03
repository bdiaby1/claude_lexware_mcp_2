import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface Config {
  port: number;
  mcpAuthToken: string;
  lexwareApiKey: string;
  lexwareApiBaseUrl: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8080),
    mcpAuthToken: requireEnv("MCP_AUTH_TOKEN"),
    lexwareApiKey: requireEnv("LEXWARE_API_KEY"),
    lexwareApiBaseUrl: process.env.LEXWARE_API_BASE_URL ?? "https://api.lexware.io/v1",
  };
}
