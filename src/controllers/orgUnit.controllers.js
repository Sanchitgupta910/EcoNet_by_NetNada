import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';

/**
 * createOrgUnit
 * -------------------------------------------
 * Creates a new organizational unit.
 *
 * Steps:
 *   1. Validate that 'name' and 'type' are provided.
 *   2. If type is "Branch", ensure that a branchAddress ID is provided.
 *   3. Create and save the OrgUnit document.
 *   4. Return the created OrgUnit.
 *
 * @route POST /api/v1/orgUnits
 */
const createOrgUnit = asyncHandler(async (req, res) => {
  const { name, type, parent, branchAddress } = req.body;

  // Validate that 'name' and 'type' are provided.
  if (!name || !type) {
    throw new ApiError(400, 'Name and type are required');
  }

  // For Branch type, branchAddress must be provided.
  if (type === 'Branch' && (!branchAddress || branchAddress.trim() === '')) {
    throw new ApiError(400, 'For a Branch, branchAddress is required');
  }

  // Create a new OrgUnit document.
  const newOrgUnit = new OrgUnit({
    name: name.trim(),
    type: type.trim(),
    parent: parent || null,
    branchAddress: branchAddress ? branchAddress.trim() : null,
  });

  try {
    await newOrgUnit.save();
  } catch (error) {
    throw new ApiError(500, 'Error creating OrgUnit: ' + error.message);
  }

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
 *   1. Retrieve the OrgUnit document by ID and populate the branchAddress field.
 *   2. If not found, throw an error.
 *   3. Return the retrieved OrgUnit.
 *
 * @route GET /api/v1/orgUnits/:id
 */
const getOrgUnit = asyncHandler(async (req, res) => {
  let orgUnit;
  try {
    orgUnit = await OrgUnit.findById(req.params.id).populate('branchAddress');
  } catch (error) {
    throw new ApiError(500, 'Error retrieving OrgUnit: ' + error.message);
  }

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
 *   1. Retrieve all OrgUnit documents and populate branchAddress for branch-type units.
 *   2. Build an in-memory tree by mapping parent-child relationships.
 *   3. Return the tree structure.
 *
 * @route GET /api/v1/orgUnits/tree
 */
const getOrgUnitTree = asyncHandler(async (req, res) => {
  let allUnits;
  try {
    // Populate branchAddress so branch OrgUnits return physical address details.
    allUnits = await OrgUnit.find().populate('branchAddress').lean();
  } catch (error) {
    throw new ApiError(500, 'Error retrieving OrgUnits: ' + error.message);
  }

  // Build a lookup map and initialize children array for each unit.
  const unitMap = {};
  allUnits.forEach((unit) => {
    unit.children = [];
    unitMap[unit._id] = unit;
  });

  // Build the tree by linking children to their parent.
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

/**
 * createOrgUnitsForBranchAddress
 * -------------------------------------------
 * Automatically creates and links the complete organizational hierarchy for a branch.
 *
 * Expected fields in req.body:
 *   - officeName: The branch’s office name.
 *   - city: The city where the branch is located.
 *   - subdivision: The region/state/territory (optional).
 *   - country: The country where the branch is located.
 *   - branchAddressId: The ID of the created BranchAddress document.
 *
 * Process:
 *   1. Validate required fields.
 *   2. For the Country level:
 *      - Look for an OrgUnit of type "Country" with the given country name.
 *      - Create one if it does not exist.
 *   3. For the Region level (if subdivision is provided):
 *      - Look for an OrgUnit of type "Region" under the Country.
 *      - Create one if not found.
 *   4. For the City level:
 *      - Determine the parent: use the Region if available; otherwise, the Country.
 *      - Look for an OrgUnit of type "City" under the determined parent.
 *      - Create one if not found.
 *   5. For the Branch level:
 *      - Look for an OrgUnit of type "Branch" with the given office name under the City.
 *      - Create one if not found, linking it to the BranchAddress.
 *
 * Returns:
 *   A JSON response with the created or found OrgUnit records for each level.
 *
 * Error Handling:
 *   - Validates required fields and uses try/catch blocks for each level.
 *
 * @route POST /api/v1/orgUnits/createBranchHierarchy
 */
const createOrgUnitsForBranchAddress = asyncHandler(async (req, res) => {
  const { officeName, city, subdivision, country, branchAddressId } = req.body;

  // Validate required fields.
  if (!officeName || !city || !country || !branchAddressId) {
    throw new ApiError(400, 'Office name, city, country, and branchAddressId are required.');
  }

  // --- Country Level ---
  let countryUnit;
  try {
    countryUnit = await OrgUnit.findOne({ name: country.trim(), type: 'Country' });
    if (!countryUnit) {
      countryUnit = await OrgUnit.create({
        name: country.trim(),
        type: 'Country',
        parent: null,
      });
    }
  } catch (error) {
    throw new ApiError(500, 'Error processing country OrgUnit: ' + error.message);
  }

  // --- Region Level (Optional) ---
  let regionUnit = null;
  if (subdivision && subdivision.trim() !== '') {
    try {
      regionUnit = await OrgUnit.findOne({
        name: subdivision.trim(),
        type: 'Region',
        parent: countryUnit._id,
      });
      if (!regionUnit) {
        regionUnit = await OrgUnit.create({
          name: subdivision.trim(),
          type: 'Region',
          parent: countryUnit._id,
        });
      }
    } catch (error) {
      throw new ApiError(500, 'Error processing region OrgUnit: ' + error.message);
    }
  }

  // --- City Level ---
  let cityUnit;
  try {
    // Determine the parent for the City: Region if available; otherwise, Country.
    const parentForCity = regionUnit ? regionUnit._id : countryUnit._id;
    cityUnit = await OrgUnit.findOne({
      name: city.trim(),
      type: 'City',
      parent: parentForCity,
    });
    if (!cityUnit) {
      cityUnit = await OrgUnit.create({
        name: city.trim(),
        type: 'City',
        parent: parentForCity,
      });
    }
  } catch (error) {
    throw new ApiError(500, 'Error processing city OrgUnit: ' + error.message);
  }

  // --- Branch Level ---
  let branchUnit;
  try {
    branchUnit = await OrgUnit.findOne({
      name: officeName.trim(),
      type: 'Branch',
      parent: cityUnit._id,
    });
    if (!branchUnit) {
      branchUnit = await OrgUnit.create({
        name: officeName.trim(),
        type: 'Branch',
        parent: cityUnit._id,
        branchAddress: branchAddressId.trim(),
      });
    }
  } catch (error) {
    throw new ApiError(500, 'Error processing branch OrgUnit: ' + error.message);
  }

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { countryUnit, regionUnit, cityUnit, branchUnit },
        'Organizational hierarchy for branch created successfully',
      ),
    );
});

export { createOrgUnit, getOrgUnit, getOrgUnitTree, createOrgUnitsForBranchAddress };
