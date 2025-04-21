import { Router } from 'express';
import { verifyJWT, authorizeRoles } from '../middlewares/auth.middleware.js';
import {
  getAdminOverview,
  getWasteTrendChart,
  getWasteDispositionRates,
} from '../controllers/LocalAdminAnalytics.controllers.js';

const router = Router();

router
  .route('/adminOverview')
  .get(
    verifyJWT,
    authorizeRoles('RegionalAdmin', 'CountryAdmin', 'CityAdmin', 'OfficeAdmin'),
    getAdminOverview,
  );
router
  .route('/wasteTrendChart')
  .get(
    verifyJWT,
    authorizeRoles('RegionalAdmin', 'CountryAdmin', 'CityAdmin', 'OfficeAdmin'),
    getWasteTrendChart,
  );
router
  .route('/wasteDisposition')
  .get(
    verifyJWT,
    authorizeRoles('RegionalAdmin', 'CountryAdmin', 'CityAdmin', 'OfficeAdmin'),
    getWasteDispositionRates,
  );

export default router;
