import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
  getLatestBinWeight,
  getBinStatus,
  getMinimalOverview,
  getWasteLast7Days,
  getWasteTrendComparison,
} from '../controllers/binDashboardAnalytics.controllers.js';

const router = Router();
// Bin and Waste Endpoints
router.get('/latestBinWeight', verifyJWT, getLatestBinWeight);
router.get('/binStatus', verifyJWT, getBinStatus);
router.get('/minimalOverview', verifyJWT, getMinimalOverview);
router.get('/wasteLast7Days', verifyJWT, getWasteLast7Days);
router.get('/wasteTrendComparison', verifyJWT, getWasteTrendComparison);
export default router;
