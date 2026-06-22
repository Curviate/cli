// SDK-client factory.
//
// Turns the resolved effective config (API key, base URL, timeout) into a
// Curviate instance. This is the single construction point — every command
// that calls the API goes through here; commands that do not call the API
// (--help, --version, login, config, webhook verify) never invoke it.
//
// Dev fills in the full config-resolution logic (profile, env, flags) in a
// follow-up pass; this module provides the factory signature for wiring.

import { Curviate } from "@curviate/sdk";

export interface ClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

/**
 * Construct a Curviate client from the resolved effective config.
 * The apiKey is passed verbatim — no prefix validation, no trimming beyond
 * surrounding whitespace. The SDK is the validator of last resort.
 */
export function createClient(config: ClientConfig): Curviate {
  return new Curviate({
    apiKey: config.apiKey.trim(),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
  });
}
