import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { redis, PREFIX } from "./redis";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

export type SessionData = {
  username: string;
  isAdmin: boolean;
};

function readTokenFromReq(req: VercelRequest): string | null {
  // 1) Authorization: Bearer <token>
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();

  // 2) Cookie: sid=<token>
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (m?.[1]) return decodeURIComponent(m[1]);

  return null;
}

export async function createSession(username: string, isAdmin: boolean) {
  const token = crypto.randomBytes(32).toString("hex");

  // optional: enforce single active session per username
  const prev = await redis.get<string>(`${PREFIX}:session_of:${username}`);
  if (prev) await redis.del(`${PREFIX}:session:${prev}`);

  await redis.set(`${PREFIX}:session_of:${username}`, token, { ex: SESSION_TTL_SECONDS });
  await redis.set(`${PREFIX}:session:${token}`, { username, isAdmin }, { ex: SESSION_TTL_SECONDS });

  return token;
}

export async function getSessionFromReq(req: VercelRequest): Promise<SessionData | null> {
  const token = readTokenFromReq(req);
  if (!token) return null;

  const data = await redis.get<SessionData>(`${PREFIX}:session:${token}`);
  if (!data?.username) return null;

  // normalize
  return { username: data.username, isAdmin: !!data.isAdmin };
}
