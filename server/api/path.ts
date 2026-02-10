import type { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import router from '../src/routes';

const app = express();

// CORS (ei haittaa vaikka käytät rewritettä; mutta jos kutsut suoraan server-domainia, tämä auttaa)
app.use(
  cors({
    origin: true, // heijastaa Originin takaisin (kehitys/beta)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Preflight aina ok
app.options('*', cors());

app.use(bodyParser.json());

// Mountataan varmuuden vuoksi molempiin, koska Vercelin path-strip käytös vaihtelee
app.use('/api', router);
app.use('/', router);

// Health
app.get('/', (_req, res) => res.send('OK'));

export default function handler(req: VercelRequest, res: VercelResponse) {
  return (app as any)(req, res);
}
