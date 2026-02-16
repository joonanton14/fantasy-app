import type { VercelRequest, VercelResponse } from "@vercel/node";

function addCors(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    addCors(req, res);
    return res.status(204).end();
  }

  addCors(req, res);

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // expire cookie
  res.setHeader(
    "Set-Cookie",
    `sid=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0`
  );

  return res.status(200).json({ ok: true });
}
