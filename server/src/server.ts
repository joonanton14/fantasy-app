import dotenv from 'dotenv';
dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('🔥 uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('🔥 unhandledRejection:', err);
});

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import router from './routes';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.options('*', cors({ origin: true, credentials: true }));

app.use(bodyParser.json());

app.use('/api', router);

// DEBUG endpoint
app.get('/debug', (_req, res) => res.json({ ok: true }));

// Error handler LAST
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('🔥 EXPRESS ERROR:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err?.message ?? String(err) });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
