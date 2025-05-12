import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ServerParameters } from "./fetch-metamcp.js";

const sleep = (time: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), time));
export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
}

/**
 * Transforms localhost URLs to use host.docker.internal when running inside Docker
 */
const transformDockerUrl = (url: string): string => {
  if (process.env.USE_DOCKER_HOST === "true") {
    return url.replace(/localhost|127\.0\.0\.1/g, "host.docker.internal");
  }
  return url;
};

export const createMetaMcpClient = (
  serverParams: ServerParameters
): { client: Client | undefined; transport: Transport | undefined } => {
  let transport: Transport | undefined;

  // Create the appropriate transport based on server type
  // Default to "STDIO" if type is undefined
  if (!serverParams.type || serverParams.type === "STDIO") {
    const stdioParams: StdioServerParameters = {
      command: serverParams.command || "",
      args: serverParams.args || undefined,
      env: serverParams.env || undefined,
      stderr: "ignore",
    };
    transport = new StdioClientTransport(stdioParams);
  } else if (serverParams.type === "SSE" && serverParams.url) {
    // Transform the URL if USE_DOCKER_HOST is set to "true"
    const transformedUrl = transformDockerUrl(serverParams.url);

    if (!serverParams.oauth_tokens) {
      transport = new SSEClientTransport(new URL(transformedUrl));
    } else {
      const headers: HeadersInit = {};
      headers[
        "Authorization"
      ] = `Bearer ${serverParams.oauth_tokens.access_token}`;
      transport = new SSEClientTransport(new URL(transformedUrl), {
        requestInit: {
          headers,
        },
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
      });
    }
  } else {
    console.error(`Unsupported server type: ${serverParams.type}`);
    return { client: undefined, transport: undefined };
  }

  const client = new Client(
    {
      name: "MetaMCP",
      version: "0.5.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
      },
    }
  );
  return { client, transport };
};

export const connectMetaMcpClient = async (
  client: Client,
  transport: Transport
): Promise<ConnectedClient | undefined> => {
  const waitFor = 2500;
  const retries = 3;
  let count = 0;
  let retry = true;

  while (retry) {
    try {
      await client.connect(transport);

      return {
        client,
        cleanup: async () => {
          await transport.close();
          await client.close();
        },
      };
    } catch (error) {
      count++;
      retry = count < retries;
      if (retry) {
        try {
          await client.close();
        } catch {}
        await sleep(waitFor);
      }
    }
  }
};
