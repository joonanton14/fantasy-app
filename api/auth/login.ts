import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../lib/session";

function addCors(req: VercelRequest, res: VercelResponse) {
  // If you are same-origin on Vercel, this is mostly harmless.
  // (If you later do cross-origin, DON'T use "*" with credentials.)
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

type UserKey = "admin" | "joona" | "olli" | "otto";

const USERS: Record<UserKey, { envPasswordKey: string; isAdmin: boolean; id: number; displayName: string }> = {
  admin: { envPasswordKey: "ADMIN_PASSWORD", isAdmin: true, id: 1, displayName: "admin" },
  joona: { envPasswordKey: "JOONA_PASSWORD", isAdmin: false, id: 2, displayName: "joona" },
  olli: { envPasswordKey: "OLLI_PASSWORD", isAdmin: false, id: 3, displayName: "olli" },
  otto: { envPasswordKey: "OTTO_PASSWORD", isAdmin: false, id: 4, displayName: "otto" },
};

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function cookieString(token: string) {
  // Vercel is https => Secure is correct.
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

    const { name, password } = (req.body ?? {}) as any;

    const key = norm(name) as UserKey;
    const pw = String(password ?? "");

    if (!key || !pw) return res.status(400).json({ error: "Name and password are required" });
    if (!(key in USERS)) return res.status(401).json({ error: "Invalid credentials" });

    const user = USERS[key];
    const expected = process.env[user.envPasswordKey];

    // This is the #1 cause on Vercel: env var not set in Production/Preview
    if (!expected) {
      return res.status(500).json({ error: `Missing env ${user.envPasswordKey} (set it in Vercel env vars)` });
    }

    if (pw !== expected) return res.status(401).json({ error: "Invalid credentials" });

    const token = await createSession(user.displayName, user.isAdmin);

    res.setHeader("Set-Cookie", cookieString(token));
    return res.status(200).json({ id: user.id, name: user.displayName, isAdmin: user.isAdmin });
  } catch (e: unknown) {
    console.error("LOGIN_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
