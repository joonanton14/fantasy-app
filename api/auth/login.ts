import type { VercelRequest, VercelResponse } from '@vercel/node';

// Example: replace with your real auth check
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, password } = req.body ?? {};
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });

  // TODO: validate against env users / redis
  if (name === process.env.JOONA_USERNAME && password === process.env.JOONA_PASSWORD) {
    // cookie example
    res.setHeader(
      'Set-Cookie',
      `sid=demo; HttpOnly; Path=/; SameSite=Lax; Secure`
    );
    return res.json({ id: 2, name, isAdmin: false });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
}
