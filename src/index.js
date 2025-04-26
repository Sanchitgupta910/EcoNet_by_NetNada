import connectDB from './db/index.js';
import dotenv from 'dotenv';
import { app } from './app.js';
import { Server as IOServer } from 'socket.io';
import http from 'http';
import redisClient from './utils/redisClient.js';

dotenv.config({
  path: './.env',
});

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: process.env.CORS_ORIGIN, credentials: true },
  path: '/socket.io',
  transports: ['polling', 'websocket'],
});

// ─── Socket.io Connections ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const { branchId } = socket.handshake.query;
  console.log('[WS] client connected:', socket.id, 'branchId=', branchId);
  if (branchId) socket.join(branchId);

  socket.on('disconnect', (reason) => {
    console.log('[WS] client disconnected:', socket.id, 'reason=', reason);
  });
});

// ─── Redis → Socket.io Bridge ────────────────────────────────────────────────────
function setupRedisSubscriber() {
  const sub = redisClient.duplicate();

  sub.on('error', (err) => {
    console.error('[Redis↪Socket] subscriber error', err);
  });

  // Subscribe once the duplicate connection is ready (it auto-connects)
  sub.on('ready', () => {
    console.log('✅ [Redis↪Socket] subscriber ready');
    sub
      .subscribe('waste-updates')
      .then((count) =>
        console.log(
          `🎉 [Redis↪Socket] subscribed to "waste-updates" (${count} channel${
            count > 1 ? 's' : ''
          })`,
        ),
      )
      .catch((err) => console.error('[Redis↪Socket] subscribe error', err));
  });

  sub.on('message', (channel, raw) => {
    console.log(`[Redis↪Socket] message on "${channel}":`, raw);
    try {
      const { branchId, payload } = JSON.parse(raw);
      if (branchId && payload) {
        io.to(branchId).emit('wasteUpdate', payload);
        console.log(`🔁 [Redis↪Socket] emitted wasteUpdate to room ${branchId}`, payload);
      }
    } catch (e) {
      console.warn('[Redis↪Socket] invalid JSON:', e);
    }
  });
}

// ─── Bootstrapping ───────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    console.log('MongoDB Connected !!');

    setupRedisSubscriber();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`🚀 HTTP+WS server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ startup failed:', err);
    process.exit(1);
  });
