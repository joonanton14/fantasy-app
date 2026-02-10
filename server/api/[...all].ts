import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import router from '../src/routes';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.options('*', cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use('/api', router);

export default app;
