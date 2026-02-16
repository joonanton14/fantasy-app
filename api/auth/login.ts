import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../lib/session";

function addCors(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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
    if (!name || !password) return res.status(400).json({ error: "Name and password are required" });

    // ✅ example: admin + users from env
    const users = [
      { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD, isAdmin: true, id: 1 },
      { username: process.env.JOONA_USERNAME, password: process.env.JOONA_PASSWORD, isAdmin: false, id: 2 },
      { username: process.env.OLLI_USERNAME, password: process.env.OLLI_PASSWORD, isAdmin: false, id: 3 },
      { username: process.env.OTTO_USERNAME, password: process.env.OTTO_PASSWORD, isAdmin: false, id: 4 },
    ].filter((u) => u.username && u.password);

    const match = users.find((u) => u.username === name && u.password === password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const token = await createSession(match.username!, match.isAdmin);

    // ✅ Set secure HttpOnly cookie
    // NOTE: Secure is required on https (Vercel production). For local dev http, you can temporarily remove Secure.
    res.setHeader(
      "Set-Cookie",
      `sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Secure`
    );

    return res.status(200).json({ id: match.id, name: match.username, isAdmin: match.isAdmin });
  } catch (e: unknown) {
    console.error("LOGIN_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
