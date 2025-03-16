// analytics.routes.js
import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
  getBinStatus,
  getMinimalOverview,
  getOverviewData,
  getWasteByStream,
  getLeaderboard,
  getActivityFeed,
} from '../controllers/analytics.controllers.js';

// Create a new router instance
const router = Router();

/**
 * GET /api/v1/analytics/binStatus
 * -------------------------------------------
 * Retrieves real-time bin status data for a branch.
 * Expects query parameter: branchId
 */
router.get('/binStatus', verifyJWT, getBinStatus);

/**
 * GET /api/v1/analytics/minimalOverview
 * -------------------------------------------
 * Retrieves minimal overview data for employee/bin display users.
 * Expects query parameter: branchId
 */
router.get('/minimalOverview', verifyJWT, getMinimalOverview);

/**
 * GET /api/v1/analytics/overview
 * -------------------------------------------
 * Retrieves an aggregated overview for admin dashboards.
 * Expects query parameters: month (YYYY-MM)
 * Optional query parameters: orgUnitId, companyId (for SuperAdmin)
 */
router.get('/overview', verifyJWT, getOverviewData);

/**
 * GET /api/v1/analytics/wasteByStream
 * -------------------------------------------
 * Retrieves time-series waste data grouped by waste stream.
 * Expects query parameter: month (YYYY-MM)
 * Optional query parameters: orgUnitId, companyId (for SuperAdmin)
 */
router.get('/wasteByStream', verifyJWT, getWasteByStream);

/**
 * GET /api/v1/analytics/leaderboard
 * -------------------------------------------
 * Returns a ranked list of branches/OrgUnits based on total waste.
 * Expects query parameters: month (YYYY-MM), orgUnitId (required)
 * Optional query parameter: companyId (for SuperAdmin)
 */
router.get('/leaderboard', verifyJWT, getLeaderboard);

/**
 * GET /api/v1/analytics/activityFeed
 * -------------------------------------------
 * Retrieves a chronological list of activity events for a selected month.
 * Expects query parameter: month (YYYY-MM)
 * Optional query parameters: orgUnitId, companyId (for SuperAdmin)
 */
router.get('/activityFeed', verifyJWT, getActivityFeed);

export default router;
