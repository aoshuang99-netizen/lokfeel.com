import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext Cloudflare adapter configuration.
 *
 * No incremental cache configured initially (keeps the Worker small and avoids
 * requiring paid R2/KV bindings). Most LokFeel pages are dynamic SSR; if ISR
 * persistence is needed later, bind an R2 bucket named NEXT_INC_CACHE_R2_BUCKET
 * and set `incrementalCache: r2IncrementalCache` here.
 */
export default defineCloudflareConfig({});
