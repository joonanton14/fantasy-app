import type { VercelRequest } from "@vercel/node";
import crypto from "crypto";

export type SessionData = {
  id: number;
  username: string;
  isAdmin: boolean;
  exp: number; // unix seconds
};

const COOKIE_NAME = "sid";
const SECRET = process.env.SESSION_SECRET || "";

function base64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecodeToBuffer(s: string) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function sign(data: string) {
  if (!SECRET) throw new Error("Missing env: SESSION_SECRET");
  return base64urlEncode(crypto.createHmac("sha256", SECRET).update(data).digest());
}

// ✅ FIX: use Uint8Array views for timingSafeEqual (TS compatibility)
function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;

  const aView = new Uint8Array(aBuf);
  const bView = new Uint8Array(bBuf);

  return crypto.timingSafeEqual(aView, bView);
}

function parseCookie(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

export async function createSession(input: { id: number; username: string; isAdmin: boolean }) {
  // Choose your lifetime (seconds)
  const ttlSeconds = 60 * 60 * 24 * 7; // 7 days
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;

  const payload: SessionData = {
    id: input.id,
    username: input.username,
    isAdmin: input.isAdmin,
    exp,
  };

  const json = JSON.stringify(payload);
  const data = base64urlEncode(Buffer.from(json, "utf8"));
  const sig = sign(data);

  return `${data}.${sig}`;
}

export async function getSessionFromReq(req: VercelRequest): Promise<SessionData | null> {
  try {
    const cookies = parseCookie(req.headers.cookie);
    const raw = cookies[COOKIE_NAME];
    if (!raw) return null;

    const token = decodeURIComponent(raw);
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;

    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expected = sign(data);
    if (!safeEqual(sig, expected)) return null;

    const json = base64urlDecodeToBuffer(data).toString("utf8");
    const session = JSON.parse(json) as SessionData;

    if (!session || typeof session !== "object") return null;
    if (typeof session.id !== "number") return null;
    if (typeof session.username !== "string") return null;
    if (typeof session.isAdmin !== "boolean") return null;
    if (typeof session.exp !== "number") return null;

    const now = Math.floor(Date.now() / 1000);
    if (session.exp <= now) return null;

    return session;
  } catch {
    return null;
  }
}