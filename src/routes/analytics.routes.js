import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
  getBinStatus,
  getLatestBinWeight,
  getMinimalOverview,
  getWasteLast7Days,
  getWasteTrendComparison,
  getAdminOverview,
  getWasteTrendChart,
  getActivityFeed,
  getAdminLeaderboard,
} from '../controllers/analytics.controllers.js';
import { getOffices } from '../controllers/offices.controllers.js';

// Create a new router instance
const router = Router();

// Bin and Waste Endpoints
router.get('/latestBinWeight', verifyJWT, getLatestBinWeight);
router.get('/binStatus', verifyJWT, getBinStatus);
router.get('/minimalOverview', verifyJWT, getMinimalOverview);
router.get('/wasteLast7Days', verifyJWT, getWasteLast7Days);
router.get('/wasteTrendComparison', verifyJWT, getWasteTrendComparison);

// Admin Overview and Trend Chart Endpoints
router.get('/adminOverview', verifyJWT, getAdminOverview);
router.get('/wasteTrendChart', verifyJWT, getWasteTrendChart);

// Activity Feed and Leaderboard Endpoints
router.get('/activityFeed', verifyJWT, getActivityFeed);
router.get('/adminLeaderboard', verifyJWT, getAdminLeaderboard);

// Offices Endpoint integrated here for admin dashboard use
router.get('/offices', verifyJWT, getOffices);

export default router;
