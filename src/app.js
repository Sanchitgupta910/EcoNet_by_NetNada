import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import redisClient from './utils/redisClient.js';

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
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());

app.use('/api/v1/company', CompanyRouter);
app.use('/api/v1/address', AddressRouter);
app.use('/api/v1/users', UserRouter);
app.use('/api/v1/dustbin', DustbinRouter);
app.use('/api/v1/waste', WasteRoute);
app.use('/api/v1/analytics', AnalyticsRouter);
app.use('/api/v1/orgUnits', OrgUnitRouter);
app.use('/api/v1/binDashboardAnalytics', BinDashboardAnalyticsRouter);
app.use('/api/v1/localAdminAnalytics', LocalAdminAnalyticsRouter);

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: process.env.CORS_ORIGIN || true, credentials: true },
  transports: ['polling', 'websocket'], // allow polling fallback
  path: '/socket.io',
  pingInterval: 5000,
  pingTimeout: 5000,
});

// ————— Redis Subscriber —————
(async () => {
  const sub = redisClient.duplicate();
  try {
    console.log('🔌 [Redis↪Socket] connecting subscriber…');
    await sub.connect();
    console.log('[Redis↪Socket] subscriber connected');

    await sub.subscribe('waste-updates', (message) => {
      console.log('[Redis↪Socket] raw message:', message);
      if (!message) return;
      let data;
      try {
        data = JSON.parse(message);
      } catch (e) {
        console.warn('[Redis↪Socket] bad JSON:', message);
        return;
      }
      const { branchId, payload } = data;
      console.log(`[Redis↪Socket] parsed → branchId=${branchId}`, payload);
      if (branchId && payload) {
        io.to(branchId).emit('wasteUpdate', payload);
        console.log(`[Redis↪Socket] emitted wasteUpdate to room ${branchId}`);
      }
    });
  } catch (err) {
    console.error('[Redis↪Socket] subscriber setup failed:', err);
  }
})();

// ————— Socket.io Connections —————
io.on('connection', (socket) => {
  const branchId = socket.handshake.query.branchId;
  console.log('[WS] client connected, branchId=', branchId, 'socket.id=', socket.id);
  if (branchId) socket.join(branchId);

  socket.on('disconnect', (reason) => {
    console.log('[WS] client disconnected', socket.id, 'reason=', reason);
    if (branchId) socket.leave(branchId);
  });
});

// log engine-level handshake errors
io.engine.on('connection_error', (err) => {
  console.error('[WS] connection_error:', err);
});

export { app, server };
