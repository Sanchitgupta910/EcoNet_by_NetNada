import { asyncHandler } from '../utils/asyncHandler';
import { OrgUnit } from '../models/orgUnit.model';
import { ApiError } from '../utils/ApiError';
import { ApiResponse } from '../utils/ApiResponse.js';

/**
 * createOrgUnit
 * -------------------------------------------
 * Creates a new organizational unit.
 *
 * Steps:
 *   1. Validate the input: name and type are required; parent is optional.
 *   2. Create a new OrgUnit document.
 *   3. Save and return the created OrgUnit.
 *
 * @route POST /api/v1/orgUnits
 */
const createOrgUnit = asyncHandler(async (req, res) => {
  const { name, type, parent } = req.body;
  if (!name || !type) {
    throw new ApiError(400, 'Name and type are required');
  }

  const newOrgUnit = new OrgUnit({
    name: name.trim(),
    type: type.trim(),
    parent: parent || null,
  });

  await newOrgUnit.save();
  return res
    .status(201)
    .json(new ApiResponse(201, newOrgUnit, 'Organizational Unit created successfully'));
});

/**
 * getOrgUnit
 * -------------------------------------------
 * Retrieves an organizational unit by its ID.
 *
 * Steps:
 *   1. Retrieve the OrgUnit document based on the provided ID.
 *   2. If not found, throw an error.
 *   3. Return the retrieved OrgUnit.
 *
 * @route GET /api/v1/orgUnits/:id
 */
const getOrgUnit = asyncHandler(async (req, res) => {
  const orgUnit = await OrgUnit.findById(req.params.id);
  if (!orgUnit) {
    throw new ApiError(404, 'Organizational Unit not found');
  }
  return res
    .status(200)
    .json(new ApiResponse(200, orgUnit, 'Organizational Unit retrieved successfully'));
});

/**
 * getOrgUnitTree
 * -------------------------------------------
 * Retrieves the entire organizational structure as a hierarchical tree.
 *
 * Steps:
 *   1. Retrieve all OrgUnit documents.
 *   2. Build an in-memory tree structure by mapping parent-child relationships.
 *   3. Return the tree structure.
 *
 * @route GET /api/v1/orgUnits/tree
 */
const getOrgUnitTree = asyncHandler(async (req, res) => {
  const allUnits = await OrgUnit.find().lean();

  // Build a map for quick lookup and initialize children arrays
  const unitMap = {};
  allUnits.forEach((unit) => {
    unit.children = [];
    unitMap[unit._id] = unit;
  });

  const tree = [];
  allUnits.forEach((unit) => {
    if (unit.parent) {
      if (unitMap[unit.parent]) {
        unitMap[unit.parent].children.push(unit);
      }
    } else {
      tree.push(unit);
    }
  });

  return res
    .status(200)
    .json(new ApiResponse(200, tree, 'Organizational structure retrieved successfully'));
});

export { createOrgUnit, getOrgUnit, getOrgUnitTree };
