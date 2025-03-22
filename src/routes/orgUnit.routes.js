// import { Router } from 'express';
// import {
//   createOrgUnit,
//   getOrgUnit,
//   getOrgUnitTree,
//   createOrgUnitsForBranchAddress,
//   getOrgUnitsByType,
// } from '../controllers/orgUnit.controllers.js';

// const router = Router();

// //Routes starts with:   /api/v1/orgUnits

// router.get('/tree', getOrgUnitTree); // Retrieve the entire organizational structure as a tree.
// router.post('/', createOrgUnit); // Create a new organizational unit.
// router.get('/:id', getOrgUnit); //  Retrieve an organizational unit by its ID.
// router.post('/createBranchHierarchy', createOrgUnitsForBranchAddress); // Create a new organizational unit for a BranchAddress.
// router.get('/byType', getOrgUnitsByType); // Retrieve all organizational units of a specific type.

// // Dynamic route: validate the ID is a valid ObjectId.
// // If it is not valid, return an error rather than attempting a DB lookup.
// router.get(
//   '/:id',
//   (req, res, next) => {
//     const id = req.params.id;
//     if (/^[0-9a-fA-F]{24}$/.test(id)) {
//       next();
//     } else {
//       // If the ID is not valid, respond with an error.
//       return next(new ApiError(400, 'Invalid OrgUnit ID'));
//     }
//   },
//   getOrgUnit,
// );
// export default router;

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
