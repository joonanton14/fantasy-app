import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.KV_REST_API_URL!,
});

export const PREFIX = "fantasy";
