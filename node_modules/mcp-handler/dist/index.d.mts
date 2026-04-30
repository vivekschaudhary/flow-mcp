import { ServerOptions as ServerOptions$1 } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { OAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

type McpEventType = "SESSION_STARTED" | "SESSION_ENDED" | "REQUEST_RECEIVED" | "REQUEST_COMPLETED" | "ERROR";
interface McpEventBase {
    type: McpEventType;
    timestamp: number;
    sessionId?: string;
    requestId?: string;
}
interface McpSessionEvent extends McpEventBase {
    type: "SESSION_STARTED" | "SESSION_ENDED";
    transport: "SSE" | "HTTP";
    clientInfo?: {
        userAgent?: string;
        ip?: string;
    };
}
interface McpRequestEvent extends McpEventBase {
    type: "REQUEST_RECEIVED" | "REQUEST_COMPLETED";
    method: string;
    parameters?: unknown;
    result?: unknown;
    duration?: number;
    status: "success" | "error";
}
interface McpErrorEvent extends McpEventBase {
    type: "ERROR";
    error: Error | string;
    context?: string;
    source: "request" | "session" | "system";
    severity: "warning" | "error" | "fatal";
}
type McpEvent = McpSessionEvent | McpRequestEvent | McpErrorEvent;

/**
 * Configuration for the MCP handler.
 * @property redisUrl - The URL of the Redis instance to use for the MCP handler.
 * @property streamableHttpEndpoint - The endpoint to use for the streamable HTTP transport.
 * @property sseEndpoint - The endpoint to use for the SSE transport.
 * @property verboseLogs - If true, enables console logging.
 */
type Config = {
    /**
     * The URL of the Redis instance to use for the MCP handler.
     * @default process.env.REDIS_URL || process.env.KV_URL
     */
    redisUrl?: string;
    /**
     * The endpoint to use for the streamable HTTP transport.
     * @deprecated Use `set basePath` instead.
     * @default "/mcp"
     */
    streamableHttpEndpoint?: string;
    /**
     * The endpoint to use for the SSE transport.
     * @deprecated Use `set basePath` instead.
     * @default "/sse"
     */
    sseEndpoint?: string;
    /**
     * The endpoint to use for the SSE messages transport.
     * @deprecated Use `set basePath` instead.
     * @default "/message"
     */
    sseMessageEndpoint?: string;
    /**
     * The maximum duration of an MCP request in seconds.
     * @default 60
     */
    maxDuration?: number;
    /**
     * If true, enables console logging.
     * @default false
     */
    verboseLogs?: boolean;
    /**
     * The base path to use for deriving endpoints.
     * If provided, endpoints will be derived from this path.
     * For example, if basePath is "/", that means your routing is:
     *  /app/[transport]/route.ts and then:
     * - streamableHttpEndpoint will be "/mcp"
     * - sseEndpoint will be "/sse"
     * - sseMessageEndpoint will be "/message"
     * @default ""
     */
    basePath?: string;
    /**
     * Callback function that receives MCP events.
     * This can be used to track analytics, debug issues, or implement custom behaviors.
     */
    onEvent?: (event: McpEvent) => void;
    /**
     * If true, disables the SSE endpoint.
     * As of 2025-03-26, SSE is not supported by the MCP spec.
     * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
     * @default false
     */
    disableSse?: boolean;
    /**
     * sessionIdGenerator for the streamable HTTP transport
     */
    sessionIdGenerator?: undefined;
};

/**
 * Creates a MCP handler that can be used to handle MCP requests.
 * @param initializeServer - A function that initializes the MCP server. Use this to access the server instance and register tools, prompts, and resources.
 * @param serverOptions - Options for the MCP server.
 * @param config - Configuration for the MCP handler.
 * @returns A function that can be used to handle MCP requests.
 */
type ServerOptions = ServerOptions$1 & {
    serverInfo?: {
        name: string;
        version: string;
    };
};
declare function createMcpRouteHandler(initializeServer: ((server: McpServer) => Promise<void>) | ((server: McpServer) => void), serverOptions?: ServerOptions, config?: Config): (request: Request) => Promise<Response>;

declare global {
    interface Request {
        auth?: AuthInfo;
    }
}
declare function withMcpAuth(handler: (req: Request) => Response | Promise<Response>, verifyToken: (req: Request, bearerToken?: string) => AuthInfo | undefined | Promise<AuthInfo | undefined>, { required, resourceMetadataPath, requiredScopes, resourceUrl, }?: {
    required?: boolean;
    resourceMetadataPath?: string;
    requiredScopes?: string[];
    /**
     * Explicit resource URL override. When provided, this URL is used as the
     * origin for constructing the resource_metadata URL. Use this when running
     * behind a proxy that doesn't set standard forwarding headers, or when you
     * need to specify a specific public URL.
     *
     * If not provided, the origin is automatically detected from proxy headers
     * (X-Forwarded-Host, X-Forwarded-Proto, Forwarded) or falls back to req.url.
     */
    resourceUrl?: string;
}): (req: Request) => Promise<Response>;

/**
 * OAuth 2.0 Protected Resource Metadata endpoint based on RFC 9728.
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 *
 * @param authServerUrls - Array of issuer URLs of the OAuth 2.0 Authorization Servers.
 *                        These should match the "issuer" field in the authorization servers'
 *                        OAuth metadata (RFC 8414).
 * @param resourceUrl - Optional explicit resource URL override. When provided, this URL is
 *                      used instead of deriving it from the request. Use this when running
 *                      behind a proxy that doesn't set standard forwarding headers.
 *                      If not provided, the URL is automatically detected from proxy headers
 *                      (X-Forwarded-Host, X-Forwarded-Proto, Forwarded) or falls back to req.url.
 */
declare function protectedResourceHandler({ authServerUrls, resourceUrl: explicitResourceUrl, }: {
    authServerUrls: string[];
    resourceUrl?: string;
}): (req: Request) => Response;
/**
 * Generates protected resource metadata for the given auth server URLs and
 * protected resource identifier. The protected resource identifier, as defined
 * in RFC 9728, should be a a URL that uses the https scheme and has no fragment
 * component.
 *
 * @param authServerUrls - Array of issuer URLs of the authorization servers. Each URL should
 *                        match the "issuer" field in the respective authorization server's
 *                        OAuth metadata (RFC 8414).
 * @param resourceUrl - the protected resource identifier
 * @param additionalMetadata - Additional metadata fields to include in the response
 * @returns Protected resource metadata, serializable to JSON
 */
declare function generateProtectedResourceMetadata({ authServerUrls, resourceUrl, additionalMetadata, }: {
    authServerUrls: string[];
    resourceUrl: string;
    additionalMetadata?: Partial<OAuthProtectedResourceMetadata>;
}): OAuthProtectedResourceMetadata;
/**
 * CORS options request handler for OAuth metadata endpoints.
 * Necessary for MCP clients that operate in web browsers.
 */
declare function metadataCorsOptionsRequestHandler(): () => Response;

/**
 * Get the public-facing origin from a request, respecting proxy headers.
 *
 * When running behind a reverse proxy (e.g., nginx, Vercel, Cloudflare),
 * the `req.url` typically reflects the internal URL (e.g., http://localhost:3000).
 * This function reconstructs the public-facing origin using standard proxy headers.
 *
 * Header precedence:
 * 1. X-Forwarded-Host + X-Forwarded-Proto (most common)
 * 2. Forwarded header (RFC 7239)
 * 3. Falls back to req.url origin
 *
 * @param req - The incoming request
 * @returns The public-facing origin (e.g., "https://example.org")
 */
declare function getPublicOrigin(req: Request): string;
/**
 * Get the public-facing URL from a request, respecting proxy headers.
 *
 * @param req - The incoming request
 * @returns The public-facing URL with the correct origin
 */
declare function getPublicUrl(req: Request): URL;

export { createMcpRouteHandler as createMcpHandler, withMcpAuth as experimental_withMcpAuth, generateProtectedResourceMetadata, getPublicOrigin, getPublicUrl, metadataCorsOptionsRequestHandler, protectedResourceHandler, withMcpAuth };
