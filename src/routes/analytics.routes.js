import express from 'express';
import { globalSummary, globalDailyWasteTrends, globalCrossCompanyComparison } from '../controllers/analytics.controllers.js';
const router = express.Router();

// Global summary endpoint for SuperAdmin dashboard analytics.
router.get('/globalSummary', globalSummary);
router.get('/dailyWasteTrends', globalDailyWasteTrends);
router.get('/crossCompanyComparison', globalCrossCompanyComparison);

export default router;
