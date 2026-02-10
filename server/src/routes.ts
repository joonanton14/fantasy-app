import { Router, Request, Response, NextFunction } from 'express';
import { teams, players, fixtures } from './data';
import { UserTeam, User, Team, Player, Fixture } from './models';
import crypto from 'crypto';

const router = Router();

// Simple in-memory session store for development. Keys are session IDs.
interface SessionUser {
  userId: number;
  name: string;
  isAdmin: boolean;
}
const sessions: Record<string, SessionUser> = {};

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    list[key] = val;
  });
  return list;
}

function getSessionId(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie as string | undefined);
  return cookies.sid;
}

function getSession(req: Request): SessionUser | null {
  const sid = getSessionId(req);
  if (!sid) return null;
  return sessions[sid] || null;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  (req as any).sessionUser = session;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req);
  if (!session || !session.isAdmin) return res.status(403).json({ error: 'Admin required' });
  (req as any).sessionUser = session;
  next();
}

// In-memory store for user-created teams. This would typically be
// persisted in a database in a real application. For demonstration
// purposes we keep it in memory.
const userTeams: UserTeam[] = [];
let nextUserTeamId = 1;

// In-memory store for application users. A real application would
// persist this in a database and implement proper authentication and
// authorization. Each user has a unique id, a name and a flag
// indicating whether they have administrative privileges.
const users: User[] = [];
let nextUserId = 1;

// Helper function to hash passwords (simple implementation for development)
// In production, use bcrypt
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Interface for user with password
interface UserWithPassword extends User {
  passwordHash: string;
}

// In-memory store for users with passwords
const usersWithPasswords: UserWithPassword[] = [];

// Initialize default users from environment variables and hardcoded defaults
function initializeDefaultUsers() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    console.warn('Warning: ADMIN_USERNAME and ADMIN_PASSWORD not set in environment variables');
    return;
  }

  // Admin user
  const adminUser: UserWithPassword = {
    id: 1,
    name: adminUsername,
    isAdmin: true,
    passwordHash: hashPassword(adminPassword)
  };
  usersWithPasswords.push(adminUser);
  users.push({ id: 1, name: adminUsername, isAdmin: true });
  console.log(`✓ Admin user initialized: ${adminUsername}`);

  // Default demo users (usernames & passwords can be set via environment variables)
  const demoUsers = [
    { id: 2, name: process.env.JOONA_USERNAME || 'joona', password: process.env.JOONA_PASSWORD || 'password123', isAdmin: false },
    { id: 3, name: process.env.OTTO_USERNAME || 'otto', password: process.env.OTTO_PASSWORD || 'password123', isAdmin: false },
    { id: 4, name: process.env.OLLI_USERNAME || 'olli', password: process.env.OLLI_PASSWORD || 'password123', isAdmin: false }
  ];

  demoUsers.forEach((demoUser) => {
    const user: UserWithPassword = {
      id: demoUser.id,
      name: demoUser.name,
      isAdmin: demoUser.isAdmin,
      passwordHash: hashPassword(demoUser.password)
    };
    usersWithPasswords.push(user);
    users.push({ id: demoUser.id, name: demoUser.name, isAdmin: demoUser.isAdmin });
    console.log(`✓ Demo user initialized: ${demoUser.name}`);
  });

  nextUserId = 5; // Set next user ID to 5
}

// Initialize users on module load
initializeDefaultUsers();

// AUTH ROUTES
// POST /api/auth/signup - create a new user account
router.post('/auth/signup', (req: Request, res: Response) => {
  const { name, password } = req.body as { name: string; password: string };

  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password are required' });
  }

  // Check if user already exists
  if (usersWithPasswords.some((u) => u.name === name)) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const userId = nextUserId++;
  const passwordHash = hashPassword(password);

  const newUser: UserWithPassword = {
    id: userId,
    name,
    isAdmin: false,
    passwordHash
  };

  usersWithPasswords.push(newUser);

  // Also add to main users array for compatibility
  const publicUser: User = { id: userId, name, isAdmin: false };
  users.push(publicUser);

  // Return user without password hash
  res.status(201).json(publicUser);
});

// POST /api/auth/login - authenticate a user
router.post('/auth/login', (req: Request, res: Response) => {
  const { name, password } = req.body as { name: string; password: string };

  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password are required' });
  }

  const user = usersWithPasswords.find((u) => u.name === name);

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Return user without password hash
  const publicUser: User = { id: user.id, name: user.name, isAdmin: user.isAdmin };
  // create a session id and set as cookie (dev-only session approach)
  const sessionId = crypto.randomBytes(16).toString('hex');
  sessions[sessionId] = { userId: user.id, name: user.name, isAdmin: user.isAdmin };
  // Simple cookie set; HttpOnly to avoid JS access
  res.setHeader('Set-Cookie', `sid=${sessionId}; HttpOnly; Path=/; SameSite=Lax`);
  res.json(publicUser);
});

// POST /api/auth/logout - clear session cookie
router.post('/auth/logout', (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid && sessions[sid]) delete sessions[sid];
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

// GET /api/teams - return all teams
router.get('/teams', (_req: Request, res: Response) => {
  res.json(teams);
});

// GET /api/players - return all players
router.get('/players', (_req: Request, res: Response) => {
  res.json(players);
});

// GET /api/fixtures - return all fixtures
router.get('/fixtures', (_req: Request, res: Response) => {
  res.json(fixtures);
});

// POST /api/user-team - create a new user team
router.post('/user-team', requireAuth, (req: Request, res: Response) => {
  const { name, players: playerIds } = req.body as { name: string; players: number[] };
  if (!name || !Array.isArray(playerIds)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const budgetUsed = playerIds.reduce((sum, id) => {
    const p = players.find((pl) => pl.id === id);
    return sum + (p ? p.value : 0);
  }, 0);
  const team: UserTeam = {
    id: nextUserTeamId++,
    name,
    players: playerIds,
    budget: budgetUsed
  };
  userTeams.push(team);
  res.status(201).json(team);
});

// GET /api/users - return all users
router.get('/users', requireAdmin, (_req: Request, res: Response) => {
  res.json(users);
});

// POST /api/users - create a new user
router.post('/users', requireAdmin, (req: Request, res: Response) => {
  const { name, isAdmin } = req.body as { name: string; isAdmin: boolean };
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const user: User = {
    id: nextUserId++,
    name,
    isAdmin: Boolean(isAdmin)
  };
  users.push(user);
  res.status(201).json(user);
});

// ADMIN ROUTES
// POST /api/admin/teams - add a new real team
router.post('/admin/teams', requireAdmin, (req: Request, res: Response) => {
  const { name } = req.body as { name: string };
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  // compute next team id by taking max existing id + 1
  const nextId = teams.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  const team: Team = { id: nextId, name };
  // push to exported teams array
  teams.push(team);
  res.status(201).json(team);
});

// POST /api/admin/players - add a new player to a team
router.post('/admin/players', requireAdmin, (req: Request, res: Response) => {
  const { name, position, teamId, value } = req.body as {
    name: string;
    position: 'GK' | 'DEF' | 'MID' | 'FWD';
    teamId: number;
    value: number;
  };
  if (!name || !position || !teamId || value === undefined) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  // validate team exists
  const teamExists = teams.some((t) => t.id === teamId);
  if (!teamExists) {
    return res.status(400).json({ error: 'Team does not exist' });
  }
  // compute next player id
  const nextId = players.reduce((max, p) => Math.max(max, p.id), 0) + 1;
  // clamp the value between 4 and 12 (inclusive)
  const clampedValue = Math.max(4, Math.min(12, Number(value)));
  const player: Player = {
    id: nextId,
    name,
    position,
    teamId,
    value: clampedValue
  };
  players.push(player);
  res.status(201).json(player);
});

// GET /api/user-team/:id - return a user team by id
router.get('/user-team/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const team = userTeams.find((t) => t.id === id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }
  res.json(team);
});

export default router;
