import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession } from "../lib/session";

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

    // ✅ Normalize username to avoid desktop/phone key mismatches (case/whitespace)
    const username = String(name).trim().toLowerCase();
    const envUser = String(process.env.JOONA_USERNAME ?? "").trim().toLowerCase();
    const envPass = String(process.env.JOONA_PASSWORD ?? "");

    const ok = username === envUser && password === envPass;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = await createSession(username);
    return res.status(200).json({ id: 2, name: username, isAdmin: false, token });
  } catch (e: unknown) {
    console.error("LOGIN_CRASH", e);
    const message = e instanceof Error ? e.message : "Server error";
    return res.status(500).json({ error: message });
  }
}
