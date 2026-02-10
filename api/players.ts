import type { VercelRequest, VercelResponse } from '@vercel/node';
import { players } from '../server/src/data';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json(players);
}
