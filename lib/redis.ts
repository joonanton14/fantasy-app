import { Redis } from "@upstash/redis";

function clean(v: string | undefined) {
  if (!v) return "";
  return v.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}

// ✅ Using Vercel KV env vars:
const rawUrl = process.env.KV_REST_API_URL;
const rawToken = process.env.KV_REST_API_TOKEN;

// If you want Upstash names instead, swap to:
// const rawUrl = process.env.UPSTASH_REDIS_REST_URL;
// const rawToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const url = clean(rawUrl);
const token = clean(rawToken);

if (!url || !token) {
  throw new Error(
    `Missing Redis env. url="${url}" hasUrl=${!!url} hasToken=${!!token}`
  );
}

if (!url.startsWith("https://")) {
  throw new Error(
    `Upstash Redis client was passed an invalid URL. Must start with https://. ` +
    `Received cleaned="${url}" raw="${rawUrl}"`
  );
}

export const redis = new Redis({ url, token });
export const PREFIX = "fantasy";
