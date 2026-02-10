import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import router from '../src/routes';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.options('*', cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

// Important: mount router at root, because Vercel already serves this under /api/*
app.use(router);

export default app;
