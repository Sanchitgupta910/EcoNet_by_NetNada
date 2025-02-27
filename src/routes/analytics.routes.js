import express from 'express';
import { globalSummary, globalDailyWasteTrends } from '../controllers/analytics.controllers.js';
const router = express.Router();

// Global summary endpoint for SuperAdmin dashboard analytics.
router.get('/globalSummary', globalSummary);
router.get('/dailyWasteTrends', globalDailyWasteTrends);

export default router;
