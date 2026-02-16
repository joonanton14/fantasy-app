import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../lib/session";

function addCors(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

type UserKey = "admin" | "joona" | "olli" | "otto";

const USERS: Record<UserKey, { displayName: string; envPasswordKey: string; isAdmin: boolean; id: number }> = {
  admin: { displayName: "admin", envPasswordKey: "ADMIN_PASSWORD", isAdmin: true, id: 1 },
  joona: { displayName: "joona", envPasswordKey: "JOONA_PASSWORD", isAdmin: false, id: 2 },
  olli: { displayName: "olli", envPasswordKey: "OLLI_PASSWORD", isAdmin: false, id: 3 },
  otto: { displayName: "otto", envPasswordKey: "OTTO_PASSWORD", isAdmin: false, id: 4 },
};

function normalizeName(input: unknown): string {
  return String(input ?? "").trim().toLowerCase();
}

function cookieString(token: string) {
  // Vercel is https → Secure is correct
  return `sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Secure`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      addCors(req, res);
      return res.status(204).end();
    }

    addCors(req, res);

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = (req.body ?? {}) as any;
    const nameRaw = body.name;
    const password = String(body.password ?? "");

    const key = normalizeName(nameRaw) as UserKey;

    if (!key || !password) return res.status(400).json({ error: "Name and password are required" });
    if (!(key in USERS)) return res.status(401).json({ error: "Invalid credentials" });

    const user = USERS[key];
    const expectedPw = process.env[user.envPasswordKey];

    // If env missing, treat as invalid (this is the usual Vercel issue)
    if (!expectedPw) {
      return res.status(500).json({ error: `Missing env ${user.envPasswordKey} in Vercel` });
    }

    if (password !== expectedPw) return res.status(401).json({ error: "Invalid credentials" });

    const token = await createSession(user.displayName, user.isAdmin);

    res.setHeader("Set-Cookie", cookieString(token));
    return res.status(200).json({ id: user.id, name: user.displayName, isAdmin: user.isAdmin });
  } catch (e: unknown) {
    console.error("LOGIN_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
