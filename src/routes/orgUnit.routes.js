import { Router } from 'express';
import {
  createOrgUnit,
  getOrgUnit,
  getOrgUnitTree,
  createOrgUnitsForBranchAddress,
} from '../controllers/orgUnit.controllers.js';

const router = Router();

router.get('/tree', getOrgUnitTree); // GET /api/v1/orgUnits/tree - Retrieve the entire organizational structure as a tree.
router.post('/', createOrgUnit); // POST /api/v1/orgUnits - Create a new organizational unit.
router.get('/:id', getOrgUnit); // GET /api/v1/orgUnits/:id - Retrieve an organizational unit by its ID.
router.post('/createBranchHierarchy', createOrgUnitsForBranchAddress); // POST /api/v1/orgUnits/createBranchHierarchy - Create a new organizational unit for a BranchAddress.
export default router;
