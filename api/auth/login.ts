import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../lib/session";
import { redis, PREFIX } from "../lib/redis";

function getClientIp(req: VercelRequest) {
  const xf = req.headers["x-forwarded-for"];
  const ip = Array.isArray(xf) ? xf[0] : xf;
  return (ip?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown").toString();
}

function norm(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

type UserDef = {
  id: number;
  username: string; // normalized
  password: string;
  isAdmin: boolean;
};

function buildUsersFromEnv(): UserDef[] {
  const defs: Array<{ id: number; u?: string; p?: string; isAdmin: boolean }> = [
    { id: 1, u: process.env.ADMIN_USERNAME, p: process.env.ADMIN_PASSWORD, isAdmin: true },
    { id: 2, u: process.env.JOONA_USERNAME, p: process.env.JOONA_PASSWORD, isAdmin: false },
    { id: 3, u: process.env.OLLI_USERNAME, p: process.env.OLLI_PASSWORD, isAdmin: false },
    { id: 4, u: process.env.OTTO_USERNAME, p: process.env.OTTO_PASSWORD, isAdmin: false },
  ];

  return defs
    .filter((d) => d.u && d.p)
    .map((d) => ({
      id: d.id,
      username: norm(d.u),
      password: String(d.p),
      isAdmin: d.isAdmin,
    }));
}

async function checkRateLimit(kind: "ip" | "user", key: string, limit: number, windowSec: number) {
  const redisKey = `${PREFIX}:rl:login:${kind}:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, windowSec);
  return { allowed: count <= limit, redisKey };
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

    const username = norm(name);
    const ip = getClientIp(req);

    // Rate limit (beta-friendly)
    const WINDOW_SEC = 10 * 60;
    const IP_LIMIT = 30;
    const USER_LIMIT = 10;

    const ipRL = await checkRateLimit("ip", ip, IP_LIMIT, WINDOW_SEC);
    const userRL = await checkRateLimit("user", username, USER_LIMIT, WINDOW_SEC);

    if (!ipRL.allowed || !userRL.allowed) {
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }

    const users = buildUsersFromEnv();
    if (users.length === 0) {
      return res.status(500).json({ error: "No users configured in environment variables" });
    }

    const found = users.find((u) => u.username === username);
    if (!found || String(password) !== found.password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Create session bound to normalized username
    const token = await createSession(found.username);

    return res.status(200).json({
      id: found.id,
      name: found.username,
      isAdmin: found.isAdmin,
      token,
    });
  } catch (e: unknown) {
    console.error("LOGIN_CRASH", e);
    const message = e instanceof Error ? e.message : "Server error";
    return res.status(500).json({ error: message });
  }
}
