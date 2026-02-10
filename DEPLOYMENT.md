# Deployment Guide

This guide explains how to deploy the Fantasy League app to Vercel with Upstash Redis.

## Prerequisites

- GitHub account
- Vercel account (free tier is sufficient)
- Upstash account (free tier is sufficient)

## Step-by-Step Deployment

### 1. Push to GitHub

First, create a repository on GitHub and push your code:

```bash
# If you haven't already:
git remote add origin https://github.com/YOUR_USERNAME/fantasy-app.git
git branch -M main
git push -u origin main
```

### 2. Create an Upstash Redis Database (Optional)

For session management and data persistence:

1. Go to [upstash.com](https://upstash.com)
2. Sign up or log in
3. Click "Create Database"
4. Choose "Redis" and select your preferred region
5. Copy the REDIS_URL (looks like: `redis://default:password@hostname:port`)

### 3. Create a Vercel Project

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Select "Import Git Repository" and choose your GitHub repo
4. Configure the project:
   - **Framework Preset:** None
   - **Root Directory:** ./ (root)
   - Click "Continue"

### 4. Add Environment Variables to Vercel

1. In Vercel project settings, go to "Environment Variables"
2. Add the following variables:

   **For All Environments (Production, Preview, Development):**
   ```
   REDIS_URL = redis://default:password@hostname:port
   PORT = 3000
   NODE_ENV = production
   ```

3. Click "Save"

### 5. Configure Build Settings (if needed)

In Vercel:
- **Build Command:** `npm run build --prefix client && npm run build --prefix server`
- **Output Directory:** `client/dist`

### 6. Deploy

Click "Deploy" and wait for the deployment to complete. Vercel will:
1. Pull your code from GitHub
2. Install dependencies
3. Build the client and server
4. Deploy to Vercel's global CDN

### 7. Verify Deployment

- Your app will be available at `https://your-project-name.vercel.app`
- API endpoints will be available at `https://your-project-name.vercel.app/api`

## Setting Up Admin Credentials

The server creates a default admin user on startup using environment variables. To set custom credentials:

1. In Vercel project settings, add environment variables:
   ```
   ADMIN_USERNAME = your_admin_username
   ADMIN_PASSWORD = your_admin_password
   ```

2. Redeploy by pushing to the main branch

## Testing the Deployment

After deployment, test these endpoints:

```bash
# Health check
curl https://your-project.vercel.app/

# Get teams
curl https://your-project.vercel.app/api/teams

# Get players
curl https://your-project.vercel.app/api/players

# Login (admin)
curl -X POST https://your-project.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"name":"admin","password":"admin123"}'
```

## Monitoring

Vercel provides:
- Real-time logs in the Vercel dashboard
- Environment variable management
- Automatic redeploys on git push
- Free SSL/TLS certificates

## Auto-Deployment

To enable automatic deployment whenever you push to GitHub:

1. Vercel is already configured for auto-deployment
2. Every push to `main` will trigger a new deployment
3. You can see deployment status in the Vercel dashboard

## Environment Variables Reference

### Server Variables
- `PORT`: Server port (default: 3000 for Vercel)
- `NODE_ENV`: Set to `production`
- `REDIS_URL`: Redis connection string (Upstash)
- `ADMIN_USERNAME`: Admin user for the app
- `ADMIN_PASSWORD`: Admin password

### Client Variables
- `VITE_API_URL`: API base URL (default: `/api` for relative URLs)

## Troubleshooting

**Build fails:**
- Check build logs in Vercel dashboard
- Ensure all dependencies are in `package.json`
- Verify `vercel.json` configuration

**Environment variables not working:**
- Verify variables are added in Vercel project settings
- Redeploy after adding variables
- Check that variable names match what code expects

**Redis connection errors:**
- Verify REDIS_URL is correct format
- Check Upstash dashboard for database status
- Ensure database is in the same region or globally accessible

**500 errors on API calls:**
- Check Vercel function logs
- Verify server code for errors
- Test locally first: `npm run dev`

## Local Development with Production Environment

To test production-like environment locally:

```bash
# Create .env with production values
echo "REDIS_URL=redis://..." > server/.env
echo "NODE_ENV=production" >> server/.env
echo "ADMIN_USERNAME=admin" >> server/.env
echo "ADMIN_PASSWORD=admin123" >> server/.env

# Run with production settings
PORT=3000 NODE_ENV=production npm run dev --prefix server
npm run dev --prefix client
```

## Next Steps

After deployment:
1. Share the URL with users
2. Set up custom domain (optional, in Vercel settings)
3. Monitor usage and logs
4. Plan feature updates and improvements

For support, visit [Vercel Docs](https://vercel.com/docs) or [Upstash Docs](https://docs.upstash.com).
