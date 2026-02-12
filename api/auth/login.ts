import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../../lib/session";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { name, password } = req.body ?? {};
  if (!name || !password) return res.status(400).json({ error: "Name and password are required" });

  // Beta: simple env-based auth
  const ok =
    name === process.env.JOONA_USERNAME && password === process.env.JOONA_PASSWORD;
    name === process.env.OLLI_USERNAME && password === process.env.OLLI_PASSWORD;
    name === process.env.OTTO_USERNAME && password === process.env.OTTO_PASSWORD;

  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = await createSession(name);

  // You can keep cookie if you want, but token is enough for API calls.
  // If you keep cookie, do NOT hardcode sid=demo; make it unique.
  return res.json({ id: 2, name, isAdmin: false, token });
}
