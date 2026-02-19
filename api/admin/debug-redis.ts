import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = `${PREFIX}:debug:ping`;
  const val = `pong-${Date.now()}`;
  await redis.set(key, val);
  const got = await redis.get(key);

  res.status(200).json({
    ok: true,
    prefix: PREFIX,
    wroteKey: key,
    wroteValue: val,
    readBack: got,
  });
}
