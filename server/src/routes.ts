import express, { Request, Response } from 'express';
import { players, teams } from './data';

const router = express.Router();

// ===== AUTH ROUTES =====
router.post('/auth/login', (req: Request, res: Response) => {
  const { name, password } = req.body;

  console.log('Login attempt:', { name, password });
  console.log('Admin creds:', { adminUser: process.env.ADMIN_USERNAME, adminPass: process.env.ADMIN_PASSWORD });

  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password are required' });
  }

  // Check admin credentials
  if (name === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    console.log('Admin login successful');
    return res.status(200).json({
      id: 0,
      name: name,
      isAdmin: true,
    });
  }

  // Check user credentials from environment variables
  const userKey = `${name.toUpperCase()}_PASSWORD`;
  const userNameKey = `${name.toUpperCase()}_USERNAME`;
  
  const storedPassword = process.env[userKey];
  const storedUsername = process.env[userNameKey];

  console.log('Checking user:', { userNameKey, userKey, storedUsername, storedPassword });

  if (storedUsername && storedPassword && name === storedUsername && password === storedPassword) {
    console.log('User login successful');
    return res.status(200).json({
      id: Math.abs(name.charCodeAt(0)),
      name: name,
      isAdmin: false,
    });
  }

  console.log('Login failed - invalid credentials');
  return res.status(401).json({ error: 'Invalid credentials' });
});

// ===== TEAMS ROUTES =====
router.get('/teams', (_req: Request, res: Response) => {
  res.json(teams);
});

router.post('/admin/teams', (req: Request, res: Response) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Team name is required' });
  }

  const newTeam = {
    id: Math.max(...teams.map(t => t.id), 0) + 1,
    name: name,
  };

  teams.push(newTeam);
  res.status(201).json(newTeam);
});

// ===== PLAYERS ROUTES =====
router.get('/players', (_req: Request, res: Response) => {
  res.json(players);
});

router.post('/admin/players', (req: Request, res: Response) => {
  const { name, position, teamId, value } = req.body;

  if (!name || !position || !teamId || value === undefined) {
    return res.status(400).json({ error: 'All player fields are required' });
  }

  const newPlayer = {
    id: Math.max(...players.map(p => p.id), 0) + 1,
    name: name,
    position: position,
    teamId: teamId,
    value: value,
  };

  players.push(newPlayer);
  res.status(201).json(newPlayer);
});

export default router;
