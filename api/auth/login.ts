import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../lib/session";
import { redis, PREFIX } from "../lib/redis";

function getClientIp(req: VercelRequest) {
  const xf = req.headers["x-forwarded-for"];
  const ip = Array.isArray(xf) ? xf[0] : xf;
  // x-forwarded-for can be "ip, proxy1, proxy2"
  return (ip?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown").toString();
}

function normUsername(name: unknown) {
  return String(name ?? "").trim().toLowerCase();
}

async function checkRateLimit(kind: "ip" | "user", key: string, limit: number, windowSec: number) {
  const redisKey = `${PREFIX}:rl:login:${kind}:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSec);
  }
  return { allowed: count <= limit, count, redisKey };
}

async function clearRateLimitKeys(keys: string[]) {
  if (!keys.length) return;
  await redis.del(...keys);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      return res.status(204).end();
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { name, password } = (req.body ?? {}) as any;
    if (!name || !password) return res.status(400).json({ error: "Name and password are required" });

    const username = normUsername(name);
    const envUser = normUsername(process.env.JOONA_USERNAME);
    const envPass = String(process.env.JOONA_PASSWORD ?? "");

    const ip = getClientIp(req);

    // Rate limit settings (beta-friendly)
    const WINDOW_SEC = 10 * 60; // 10 minutes
    const IP_LIMIT = 30;        // 30 attempts per IP / 10 min
    const USER_LIMIT = 10;      // 10 attempts per username / 10 min

    const ipRL = await checkRateLimit("ip", ip, IP_LIMIT, WINDOW_SEC);
    const userRL = await checkRateLimit("user", username, USER_LIMIT, WINDOW_SEC);

    if (!ipRL.allowed || !userRL.allowed) {
      return res.status(429).json({
        error: "Too many login attempts. Try again later.",
      });
    }

    const ok = username === envUser && password === envPass;
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Successful login -> clear rate limit counters (nice UX)
    await clearRateLimitKeys([ipRL.redisKey, userRL.redisKey]);

    const token = await createSession(username);
    return res.status(200).json({ id: 2, name: username, isAdmin: false, token });
  } catch (e: unknown) {
    console.error("LOGIN_CRASH", e);
    const message = e instanceof Error ? e.message : "Server error";
    return res.status(500).json({ error: message });
  }
}
