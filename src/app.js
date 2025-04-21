import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import { Server } from 'socket.io';

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
// import { initRealTimeUpdates } from './controllers/binDashboardAnalytics.controllers.js';

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

// Create HTTP server and attach Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  },
  transports: ['websocket'],
  pingInterval: 5000, // send a ping every 5 seconds
  pingTimeout: 5000,
});

// Socket.io connection handling
// io.on('connection', (socket) => {
//   console.log(`Client connected: ${socket.id}`);

//   socket.on('disconnect', () => {
//     console.log(`Client disconnected: ${socket.id}`);
//   });
// });

// // Initialize real-time updates using Socket.io.

// initRealTimeUpdates(io);

export { app, server };
