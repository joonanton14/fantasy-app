import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import router from './routes';

const app = express();

// If you use cookies for auth, CORS must allow credentials AND specify origin.
// In production (Vercel), your client is a different domain unless you use rewrites.
// If you use client-side rewrites (/api -> server), then origin is same and this is fine.
// For now, keep it permissive; tighten later.
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(bodyParser.json());

// Health check
app.get('/', (_req, res) => {
  res.send('Fantasy league server is running');
});

// Prefix all API routes with /api
app.use('/api', router);

export default app;

// Local dev only (Vercel provides the runtime)
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 3001;
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
