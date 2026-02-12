import type { VercelRequest } from "@vercel/node";
import crypto from "node:crypto";
import { redis, PREFIX } from "./redis";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function createSession(username: string) {
  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(`${PREFIX}:session:${token}`, { username }, { ex: SESSION_TTL_SECONDS });
  return token;
}

export async function getSessionFromReq(req: VercelRequest): Promise<{ username: string } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;

  const session = await redis.get<{ username: string }>(`${PREFIX}:session:${token}`);
  return session ?? null;
}
