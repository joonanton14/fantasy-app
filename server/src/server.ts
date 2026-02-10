import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import router from './routes';

const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// Prefix all API routes with /api
app.use('/api', router);

// Health check endpoint
app.get('/', (_req, res) => {
  res.send('Fantasy league server is running');
});

export default app;

// Local-only listen (Vercel provides the server)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}
