// api/admin/finalize-game.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import {
  scoreTeamForGameWithAutosub,
  type TeamData,
  type PlayerLite,
  type PlayerEventInput,
} from "../../lib/scoring";

import { players } from "../../server/src/data";

function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
}

type ScanReply = [string, string[]];

async function scanAllTeamKeys(): Promise<string[]> {
  const match = `${PREFIX}:team:*`;
  let cursor = "0";
  const keysAll: string[] = [];

  while (true) {
    const reply = (await (redis as any).scan(cursor, { match, count: 200 })) as ScanReply;

    const nextCursor: string = reply[0];
    const keys: string[] = reply[1] ?? [];

    keysAll.push(...keys);

    cursor = nextCursor;
    if (cursor === "0") break;
  }

  return keysAll;
}

async function scanAllTeamUsernames(): Promise<string[]> {
  const keys = await scanAllTeamKeys();

  const usernames = new Set<string>();
  for (const key of keys) {
    // key format: fantasy:team:<username>
    const parts = String(key).split(":");
    const maybeUser = parts[parts.length - 1] ?? "";
    if (maybeUser) usernames.add(normalizeUsername(maybeUser));
  }

  return Array.from(usernames);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const gameId = Number(req.body?.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return res.status(400).json({ error: "Invalid gameId" });
    }

    const eventsKey = `${PREFIX}:game:${gameId}:events`;
    const eventsById = (await redis.get<Record<string, PlayerEventInput>>(eventsKey)) ?? {};

    const playersById = new Map<number, PlayerLite>();
    for (const p of players) {
      playersById.set(p.id, { id: p.id, position: p.position });
    }

    const discoveredUsers = await scanAllTeamUsernames();

    const results: Array<{ username: string; points: number; subsUsed: number[] }> = [];
    const perUserDebug: Array<any> = [];

    for (const usernameRaw of discoveredUsers) {
      const username = normalizeUsername(usernameRaw);
      const teamKey = `${PREFIX}:team:${username}`;

      const team = (await redis.get<TeamData>(teamKey)) ?? null;

      const startingXIIds = team?.startingXIIds ?? [];
      const benchIds = team?.benchIds ?? [];

      const startingMatches = startingXIIds.filter((id) => playersById.has(id)).length;

      const { total, subsUsed } = scoreTeamForGameWithAutosub({
        team: { startingXIIds, benchIds },
        playersById,
        eventsById,
      });

      results.push({ username, points: total, subsUsed });

      await redis.set(`${PREFIX}:user:${username}:game:${gameId}:points`, total);
      await redis.set(`${PREFIX}:user:${username}:game:${gameId}:subs`, subsUsed);

      perUserDebug.push({
        username,
        teamKey,
        teamExists: !!team,
        startingLen: startingXIIds.length,
        benchLen: benchIds.length,
        startingMatches,
      });
    }

    await redis.sadd(`${PREFIX}:games_finalized`, String(gameId));

    return res.status(200).json({
      ok: true,
      gameId,
      results,
      debug: {
        prefix: PREFIX,
        eventsKey,
        eventsCount: Object.keys(eventsById).length,
        playersByIdSize: playersById.size,
        discoveredUsersCount: discoveredUsers.length,
        discoveredUsers,
        perUserDebug,
      },
    });
  } catch (e: unknown) {
    console.error("FINALIZE_GAME_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}
