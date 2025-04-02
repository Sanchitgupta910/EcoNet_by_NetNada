import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
  getLatestBinWeight,
  getBinStatus,
  getAdminOverview,
  getMinimalOverview,
  getWasteLast7Days,
  getActivityFeed,
  getLeaderboardData,
  getWasteTrendChart,
  getWasteDispositionRates,
} from '../controllers/analytics.controllers.js';
import { getOffices } from '../controllers/offices.controllers.js';

// Create a new router instance
const router = Router();

// Bin and Waste Endpoints
router.get('/latestBinWeight', verifyJWT, getLatestBinWeight);
router.get('/binStatus', verifyJWT, getBinStatus);
router.get('/minimalOverview', verifyJWT, getMinimalOverview);
router.get('/wasteLast7Days', verifyJWT, getWasteLast7Days);

// Admin Overview and Trend Chart Endpoints
router.get('/adminOverview', verifyJWT, getAdminOverview);
router.get('/wasteTrendChart', verifyJWT, getWasteTrendChart);
router.get('/wasteDisposition', verifyJWT, getWasteDispositionRates);

// Activity Feed and Leaderboard Endpoints
router.get('/activityFeed', verifyJWT, getActivityFeed);
router.get('/leaderboard', verifyJWT , getLeaderboardData);

// Offices Endpoint for admin dashboard use
router.get('/offices', verifyJWT, getOffices);

export default router;
