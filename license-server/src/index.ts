import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initDatabase } from './database';
import authRouter from './routes/auth';
import entitlementRouter from './routes/entitlement';
import { startCronJobs } from './cron';

const PORT = parseInt(process.env.PORT || '3500', 10);

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: true, // Allow requests from desktop app
    credentials: true,
  })
);
app.use(express.json());

// ─── Health ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ─────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/entitlement', entitlementRouter);

// ─── Start ──────────────────────────────────────────────────────────────
initDatabase();
startCronJobs();

app.listen(PORT, () => {
  console.log(`License server running on port ${PORT}`);
});

export default app;
