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
 * createOrgUnitsForBranchAddressService
 * -----------------------------------------------------
 * Creates the complete hierarchical OrgUnit structure for a branch.
 * Each OrgUnit name is built using the companyName along with the specific location detail.
 *
 * Parameters:
 *   - companyName: String used as a prefix in all OrgUnit names.
 *   - officeName: The branch’s office name.
 *   - city: The branch's city.
 *   - subdivision: The region/state (if available).
 *   - country: The branch's country.
 *   - branchAddressId: The ObjectId of the created branch address.
 *
 * Returns:
 *   An object with the records created or found: { countryUnit, regionUnit, cityUnit, branchUnit }.
 */
export const createOrgUnitsForBranchAddressService = async ({
  companyName,
  officeName,
  city,
  subdivision,
  country,
  branchAddressId,
}) => {
  // Format names with the company name as prefix.
  const countryName = `${companyName}_${country.trim()}`;
  const regionName =
    subdivision && subdivision.trim() !== '' ? `${companyName}_${subdivision.trim()}` : null;
  const cityName = `${companyName}_${city.trim()}`;
  const branchUnitName = `${companyName}_${officeName.trim()}`;

  // --- Country Level ---
  let countryUnit;
  try {
    countryUnit = await OrgUnit.findOne({ name: countryName, type: 'Country' });
    if (!countryUnit) {
      countryUnit = await OrgUnit.create({
        name: countryName,
        type: 'Country',
        parent: null,
      });
    }
  } catch (error) {
    throw new ApiError(500, 'Error processing country OrgUnit: ' + error.message);
  }

  // --- Region Level (Optional) ---
  let regionUnit = null;
  if (regionName) {
    try {
      regionUnit = await OrgUnit.findOne({
        name: regionName,
        type: 'Region',
        parent: countryUnit._id,
      });
      if (!regionUnit) {
        regionUnit = await OrgUnit.create({
          name: regionName,
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
    const parentForCity = regionUnit ? regionUnit._id : countryUnit._id;
    cityUnit = await OrgUnit.findOne({
      name: cityName,
      type: 'City',
      parent: parentForCity,
    });
    if (!cityUnit) {
      cityUnit = await OrgUnit.create({
        name: cityName,
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
      name: branchUnitName,
      type: 'Branch',
      parent: cityUnit._id,
    });
    if (!branchUnit) {
      branchUnit = await OrgUnit.create({
        name: branchUnitName,
        type: 'Branch',
        parent: cityUnit._id,
        branchAddress: branchAddressId.toString(), // Safely convert ObjectId to string.
      });
    }
  } catch (error) {
    throw new ApiError(500, 'Error processing branch OrgUnit: ' + error.message);
  }

  return { countryUnit, regionUnit, cityUnit, branchUnit };
};

/**
 * createOrgUnitsForBranchAddress
 * -------------------------------------------
 * Express endpoint to create the organizational hierarchy for a branch.
 * Expects: companyName, officeName, city, subdivision, country, branchAddressId in req.body.
 *
 * @route POST /api/v1/orgUnits/createBranchHierarchy
 */
const createOrgUnitsForBranchAddress = asyncHandler(async (req, res) => {
  const { companyName, officeName, city, subdivision, country, branchAddressId } = req.body;
  if (!companyName || !officeName || !city || !country || !branchAddressId) {
    throw new ApiError(
      400,
      'Company name, office name, city, country, and branchAddressId are required.',
    );
  }
  const orgUnits = await createOrgUnitsForBranchAddressService({
    companyName,
    officeName,
    city,
    subdivision,
    country,
    branchAddressId,
  });
  return res
    .status(201)
    .json(
      new ApiResponse(201, orgUnits, 'Organizational hierarchy for branch created successfully'),
    );
});

/**
 * getOrgUnitsByType
 * -------------------------------------------
 * Retrieves OrgUnit records filtered by a given type.
 *
 * Expected query parameter:
 *   - type: The type of OrgUnit to retrieve (e.g., "Country", "Region", "City", or "Branch").
 *
 * Process:
 *   1. Validate that the 'type' query parameter is provided.
 *   2. Query the OrgUnit collection for records with the matching type.
 *   3. Populate the branchAddress field for branch-type units.
 *   4. Return the list of OrgUnit records.
 *
 * @route GET /api/v1/orgUnits/byType
 */
const getOrgUnitsByType = asyncHandler(async (req, res) => {
  const { type } = req.query;
  if (!type) {
    throw new ApiError(400, 'OrgUnit type query parameter is required');
  }

  let units;
  try {
    units = await OrgUnit.find({ type: type.trim() }).populate('branchAddress').lean();
  } catch (error) {
    throw new ApiError(500, 'Error retrieving OrgUnits: ' + error.message);
  }

  return res.status(200).json(new ApiResponse(200, units, 'OrgUnits retrieved successfully'));
});

export {
  createOrgUnit,
  getOrgUnit,
  getOrgUnitTree,
  createOrgUnitsForBranchAddress,
  getOrgUnitsByType,
};
