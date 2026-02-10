import type { VercelRequest, VercelResponse } from '@vercel/node';
import { teams } from '../server/src/data';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json(teams);
}
