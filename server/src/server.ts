// Load environment variables from server/.env FIRST, before any other imports
import dotenv from 'dotenv';
import path from 'path';

// Resolve .env relative to the compiled JS location (server/dist)
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import router from './routes';

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Prefix all API routes with /api
app.use('/api', router);

// Health check endpoint
app.get('/', (_req, res) => {
  res.send('Fantasy league server is running');
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});