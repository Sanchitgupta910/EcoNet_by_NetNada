import express from 'express';
import { branchWasteBreakdown, dailyDiversionRecycling, globalSummary, globalDailyWasteTrends, globalWasteBreakdown, crossCompanyComparison, leaderboards } from '../controllers/analytics.controllers.js';
const router = express.Router();

// Branch waste summary endpoint for Admin dashboard analytics.
router.get('/branchWasteBreakdown', branchWasteBreakdown);
router.get("/dailyDiversionRecycling", dailyDiversionRecycling);

// Global summary endpoint for Admin dashboard analytics.
router.get("/globalSummary", globalSummary);
router.get("/globalDailyWasteTrends", globalDailyWasteTrends);
router.get("/globalWasteBreakdown", globalWasteBreakdown);
router.get("/crossCompanyComparison", crossCompanyComparison);
router.get("/leaderboards", leaderboards);



export default router;
