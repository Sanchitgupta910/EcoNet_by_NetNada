import express from 'express';
import { branchWasteBreakdown, branchWasteRates } from '../controllers/analytics.controllers.js';
const router = express.Router();

// Global summary endpoint for SuperAdmin dashboard analytics.
router.get('/branchWasteBreakdown', branchWasteBreakdown);
router.get('/branchWasteRates', branchWasteRates);


export default router;
