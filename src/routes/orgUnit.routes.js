
import { Router } from 'express';
import { ApiError } from '../utils/ApiError.js';
import {
  createOrgUnit,
  getOrgUnit,
  getOrgUnitTree,
  createOrgUnitsForBranchAddress,
  getOrgUnitsByType,
  getGroupedOrgUnits,
} from '../controllers/orgUnit.controllers.js';

const router = Router();

// Static routes first
router.get('/tree', getOrgUnitTree); // Retrieve the entire organizational structure as a tree.
router.post('/', createOrgUnit); // Create a new organizational unit.
router.post('/createBranchHierarchy', createOrgUnitsForBranchAddress); // Create OrgUnits for a branch address.
router.get('/byType', getOrgUnitsByType); // Retrieve all OrgUnits filtered by type.
router.get('/grouped', getGroupedOrgUnits); // Retrieve distinct OrgUnits grouped by their type.
// Dynamic route: validate the ID is a valid ObjectId before retrieving a single OrgUnit.
router.get(
  '/:id',
  (req, res, next) => {
    const id = req.params.id;
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      next();
    } else {
      return next(new ApiError(400, 'Invalid OrgUnit ID'));
    }
  },
  getOrgUnit,
);

export default router;
