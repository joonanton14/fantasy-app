import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../../lib/session";

function addCors(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

type UserConfig = {
  key: string;
  username?: string;
  password?: string;
  isAdmin: boolean;
  id: number;
};

function norm(s: unknown) {
  return String(s ?? "").trim();
}

function cookieString(token: string) {
  return `sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Secure`;
}

function loadUsersFromEnv(): UserConfig[] {
  const defs = [
    { key: "ADMIN", isAdmin: true, id: 1 },
    { key: "JOONA", isAdmin: false, id: 2 },
    { key: "OLLI", isAdmin: false, id: 3 },
    { key: "OTTO", isAdmin: false, id: 4 },
  ] as const;

  return defs.map((d) => ({
    key: d.key,
    isAdmin: d.isAdmin,
    id: d.id,
    username: process.env[`${d.key}_USERNAME`],
    password: process.env[`${d.key}_PASSWORD`],
  }));
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
    const inputName = norm(name);
    const inputPw = String(password ?? "");

    if (!inputName || !inputPw) return res.status(400).json({ error: "Name and password are required" });

    const users = loadUsersFromEnv();

    // Optional: if env missing, fail loudly so you notice in Vercel logs/UI
    const missing = users
      .filter((u) => !u.username || !u.password)
      .map((u) => `${u.key}_USERNAME / ${u.key}_PASSWORD`);
    if (missing.length) {
      return res.status(500).json({ error: `Missing env: ${missing.join(", ")}` });
    }

    // Match typed name to env username (case-sensitive or insensitive - choose one)
    // I recommend case-insensitive:
    const match = users.find((u) => u.username!.toLowerCase() === inputName.toLowerCase());

    if (!match) return res.status(401).json({ error: "Invalid credentials" });
    if (inputPw !== match.password) return res.status(401).json({ error: "Invalid credentials" });
    
    // Store session username as the *actual* username from env
    const token = await createSession(match.username!, match.isAdmin);

    res.setHeader("Set-Cookie", cookieString(token));
    return res.status(200).json({ id: match.id, name: match.username, isAdmin: match.isAdmin });
  } catch (e: unknown) {
    console.error("LOGIN_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
