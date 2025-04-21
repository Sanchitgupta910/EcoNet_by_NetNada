import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import redis from './utils/redisClient.js';

//Routes import
import CompanyRouter from './routes/company.routes.js';
import AddressRouter from './routes/address.routes.js';
import UserRouter from './routes/user.routes.js';
import DustbinRouter from './routes/dustbin.routes.js';
import WasteRoute from './routes/waste.routes.js';
import AnalyticsRouter from './routes/analytics.routes.js';
import OrgUnitRouter from './routes/orgUnit.routes.js';
import BinDashboardAnalyticsRouter from './routes/binDashboardAnalytics.routes.js';
import LocalAdminAnalyticsRouter from './routes/LocalAdminAnalytics.routes.js';

const app = express();
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
// app.use(express.static())
app.use(cookieParser());

//routes declaration
app.use('/api/v1/company', CompanyRouter);
app.use('/api/v1/address', AddressRouter);
app.use('/api/v1/users', UserRouter);
app.use('/api/v1/dustbin', DustbinRouter);
app.use('/api/v1/waste', WasteRoute);
app.use('/api/v1/analytics', AnalyticsRouter);
app.use('/api/v1/orgUnits', OrgUnitRouter);
app.use('/api/v1/binDashboardAnalytics', BinDashboardAnalyticsRouter);
app.use('/api/v1/localAdminAnalytics', LocalAdminAnalyticsRouter);

// Create HTTP server & attach Socket.io
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: process.env.CORS_ORIGIN, credentials: true },
  transports: ['websocket'],
  pingInterval: 5000,
  pingTimeout: 5000,
});

// Robust subscriber setup
(async () => {
  const sub = redis.duplicate();

  sub.on('error', (err) => {
    console.error('Redis subscriber error:', err);
  });

  // no await sub.connect()
  await sub.subscribe('waste‑updates', (message) => {
    if (!message) return;
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      console.warn('⚠️ bad JSON on waste‑updates:', message);
      return;
    }
    const { branchId, payload } = data || {};
    if (branchId && payload) {
      io.to(branchId).emit('wasteUpdate', payload);
    }
  });
})().catch((err) => {
  console.error('🔥 Failed to set up Redis subscription:', err);
});

// Socket.io connection
io.on('connection', (socket) => {
  const { branchId } = socket.handshake.query;
  if (branchId) socket.join(branchId);

  socket.on('disconnect', () => {
    if (branchId) socket.leave(branchId);
  });
});

export { app, server };
