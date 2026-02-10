# Fantasy League Application (Prototype)

This repository contains a simple fantasy sports application built with **Node/Express** (back‑end) and **React with TypeScript** (front‑end).  It uses rules inspired by the Fantasy Premier League (FPL) but excludes the defensive‐contribution (defcon) points and chips.  Player values are based on Transfermarkt valuations and clamped between **4 M€** and **12 M€**.  The app allows you to select a 15‑player squad within a 100 M€ budget and enforce a maximum of three players from any real team.

## Structure

```
fantasy-app/
  ├── server/          # Node/Express API
  │   ├── package.json
  │   ├── tsconfig.json
  │   ├── src/
  │   │   ├── data.ts      # Sample teams, players and fixtures
  │   │   ├── models.ts    # Type definitions
  │   │   ├── routes.ts    # REST API routes
  │   │   └── server.ts    # Express server entry point
  ├── client/          # React front‑end (Vite + TypeScript)
  │   ├── package.json
  │   ├── vite.config.ts
  │   ├── tsconfig.json
  │   ├── index.html
  │   └── src/
  │       ├── main.tsx   # Entry point for React
  │       └── App.tsx    # Simple team builder UI
  └── README.md
```

## Getting Started

**Prerequisites:** Node 18+ and npm.  The steps below assume you run the commands from the `fantasy-app` directory.

### 1. Install dependencies

```bash
cd server
npm install

# In a separate terminal
cd ../client
npm install
```

### 2. Generate Veikkausliiga player data

Before running the app, fetch or generate the Veikkausliiga player dataset:

```bash
cd server
node fetchVeikkausLiigaData.js
```

This script will:
- Attempt to fetch real Transfermarkt data from GitHub (currently returns 404—the repository paths need verification)
- Fall back to generating sample Veikkausliiga players with realistic names and teams
- Scale player market values to the fantasy range (4–12 M€)
- Save the data to `veikkausliiga_players.json`

The server automatically loads this file on startup.

### 3. Run the development servers

Start the back‑end API first:

```bash
cd server
npm run dev
```

Then start the front‑end (the Vite dev server proxies API calls to port 3001):

```bash
cd client
npm run dev
```

Visit `http://localhost:5173` in your browser.  You should see a team builder interface where you can add players to your squad until you reach 15 players or run out of budget.

## Features

- **Teams and players:** Data are defined in `server/src/data.ts`.  Four example teams are provided, each with 15 players (2 GK, 5 DEF, 5 MID, 3 FWD) and random valuations between 4 and 12 M€.
- **Fixtures:** A simple round‑robin schedule is generated so that each team plays each other home and away.  In a real system you would replace this with the actual league schedule.
- **REST API:** The back‑end exposes the following endpoints under `/api`:
  - `GET /api/teams` – list of teams.
  - `GET /api/players` – list of players.
  - `GET /api/fixtures` – list of fixtures (match schedule).
  - `POST /api/user-team` – create a fantasy team with a name and a list of player IDs.  Responds with the created team, including calculated budget.
  - `GET /api/user-team/:id` – fetch a previously created fantasy team by ID.

- **Front‑end UI:** The React UI fetches players and teams on load.  Users can select up to 15 players, with constraints:
  - Maximum of three players per real team.
  - Squad budget capped at 100 M€ (adjustable in `App.tsx`).
  - Selected players are listed with the ability to remove them.  The table of available players disables the “Add” button when constraints would be violated.

## Environment Variables

Create `.env` files in both the `server` and `client` directories to configure the application.

### Server (.env)

```
NODE_ENV=development
PORT=3001
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
REDIS_URL=redis://localhost:6379
```

- `NODE_ENV`: Set to `development` or `production`
- `PORT`: Server port (default: 3001)
- `ADMIN_USERNAME`: Username for the admin account (created on startup)
- `ADMIN_PASSWORD`: Password for the admin account
- `REDIS_URL`: Redis connection string (optional, for Upstash on Vercel)

An admin user is automatically created on server startup using these credentials. For production deployment to Vercel, update these values in your Vercel environment settings.

### Client (.env)

```
VITE_API_URL=http://localhost:3001
```

- `VITE_API_URL`: API server URL (change to your production URL when deployed)

**Important:** Never commit `.env` files to git. Use `.env.example` as a template and add `.env` to `.gitignore`.

## Deployment

### Deploy to Vercel

1. **Create a GitHub Repository**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/fantasy-app.git
   git branch -M main
   git push -u origin main
   ```

2. **Create a Vercel Project**
   - Go to [vercel.com](https://vercel.com) and sign in
   - Click "New Project" and import your GitHub repository
   - Set the following environment variables in Vercel project settings:

   **Environment Variables:**
   - `REDIS_URL`: Your Upstash Redis connection string

3. **Set up Upstash Redis (Optional)**
   - Create an account at [upstash.com](https://upstash.com)
   - Create a new Redis database
   - Copy the connection string to `REDIS_URL` in Vercel environment variables

4. **Deploy**
   - Push to `main` branch to auto-deploy
   - Vercel will build and deploy automatically

### Deploy Locally

```bash
# Start both servers
./start-all.ps1  # Windows PowerShell
# or
./start-all.bat  # Windows Command Prompt
```

Visit `http://localhost:5173` for the client and `http://localhost:3001` for the API.

## Next Steps

This prototype serves as a foundation.  To turn it into a full‑fledged fantasy game you could:

- Replace the generated data with real teams, players and fixtures (e.g. by importing Transfermarkt valuations or official league schedules).
- Persist user teams and scores in a database instead of in memory. When deploying to Vercel, integrate with Redis for session and user data storage.
- Improve authentication with JWT tokens and secure password hashing (use `bcrypt` instead of SHA-256).
- Add a scoring system that mirrors FPL rules (without defcon and chips).  After each matchday you could update player scores manually or write a script to calculate points based on real match statistics.
- Build administrative tools for manually entering points, or integrate with an external statistics provider.
- Deploy the front‑end to Vercel and the back‑end to Vercel Functions or a cloud service (AWS, Heroku, etc.).

Feel free to customise and extend the application to meet your specific requirements.