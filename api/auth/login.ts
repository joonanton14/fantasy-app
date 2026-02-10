import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

type User = { id: number; name: string; isAdmin: boolean; passwordHash: string };

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getUsersFromEnv(): User[] {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) return [];

  const users: User[] = [
    {
      id: 1,
      name: adminUsername,
      isAdmin: true,
      passwordHash: hashPassword(adminPassword),
    },
    {
      id: 2,
      name: process.env.JOONA_USERNAME || 'joona',
      isAdmin: false,
      passwordHash: hashPassword(process.env.JOONA_PASSWORD || 'password123'),
    },
    {
      id: 3,
      name: process.env.OTTO_USERNAME || 'otto',
      isAdmin: false,
      passwordHash: hashPassword(process.env.OTTO_PASSWORD || 'password123'),
    },
    {
      id: 4,
      name: process.env.OLLI_USERNAME || 'olli',
      isAdmin: false,
      passwordHash: hashPassword(process.env.OLLI_PASSWORD || 'password123'),
    },
  ];

  return users;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, password } = (req.body || {}) as { name?: string; password?: string };
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });

  const users = getUsersFromEnv();
  const user = users.find((u) => u.name === name);

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // return public user (no sessions for now)
  return res.status(200).json({ id: user.id, name: user.name, isAdmin: user.isAdmin });
}
