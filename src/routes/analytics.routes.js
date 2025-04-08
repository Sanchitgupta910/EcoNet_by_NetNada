import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
  getAdminOverview,
  getActivityFeed,
  getLeaderboardData,
  getWasteTrendChart,
  getWasteDispositionRates,
} from '../controllers/analytics.controllers.js';
import { getOffices } from '../controllers/offices.controllers.js';

// Create a new router instance
const router = Router();
// Admin Overview and Trend Chart Endpoints
router.get('/adminOverview', verifyJWT, getAdminOverview);
router.get('/wasteTrendChart', verifyJWT, getWasteTrendChart);
router.get('/wasteDisposition', verifyJWT, getWasteDispositionRates);

// Activity Feed and Leaderboard Endpoints
router.get('/activityFeed', verifyJWT, getActivityFeed);
router.get('/leaderboard', verifyJWT, getLeaderboardData);

// Offices Endpoint for admin dashboard use
router.get('/offices', verifyJWT, getOffices);


export default router;