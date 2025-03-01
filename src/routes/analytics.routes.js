import express from 'express';
import { branchWasteBreakdown, dailyDiversionRecycling } from '../controllers/analytics.controllers.js';
const router = express.Router();

// Global summary endpoint for SuperAdmin dashboard analytics.
router.get('/branchWasteBreakdown', branchWasteBreakdown);
router.get("/dailyDiversionRecycling", dailyDiversionRecycling);

export default router;
