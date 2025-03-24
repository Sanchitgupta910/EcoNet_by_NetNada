import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import { Company } from '../models/company.models.js';

/**
 * createOrgUnit
 * -------------------------------------------
 * Creates a new organizational unit.
 * Expects: name, type, company, and optionally parent and branchAddress.
 */
export const createOrgUnit = asyncHandler(async (req, res) => {
  const { name, type, parent, branchAddress, company } = req.body;

  if (!name || !type || !company) {
    throw new ApiError(400, 'Name, type, and company are required');
  }

  const newOrgUnit = new OrgUnit({
    name: name.trim(),
    type: type.trim(),
    parent: parent || null,
    branchAddress: branchAddress ? branchAddress.trim() : null,
    company, // company id must be provided
  });

  try {
    await newOrgUnit.save();
  } catch (error) {
    throw new ApiError(500, 'Error creating OrgUnit: ' + error.message);
  }

  return res
    .status(201)
    .json({ success: true, data: newOrgUnit, message: 'Organizational Unit created successfully' });
});

/**
 * getOrgUnit
 * -------------------------------------------
 * Retrieves an OrgUnit by its ID.
 */
export const getOrgUnit = asyncHandler(async (req, res) => {
  let orgUnit;
  try {
    orgUnit = await OrgUnit.findById(req.params.id).populate('branchAddress').lean();
  } catch (error) {
    throw new ApiError(500, 'Error retrieving OrgUnit: ' + error.message);
  }

  if (!orgUnit) {
    throw new ApiError(404, 'Organizational Unit not found');
  }

  return res
    .status(200)
    .json({ success: true, data: orgUnit, message: 'Organizational Unit retrieved successfully' });
});

/**
 * getOrgUnitTree
 * -------------------------------------------
 * Retrieves all OrgUnits and organizes them into a hierarchical tree.
 */
export const getOrgUnitTree = asyncHandler(async (req, res) => {
  let allUnits;
  try {
    // Populate branchAddress for branch OrgUnits for more details.
    allUnits = await OrgUnit.find().populate('branchAddress').lean();
  } catch (error) {
    throw new ApiError(500, 'Error retrieving OrgUnits: ' + error.message);
  }

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

  return res.status(200).json({
    success: true,
    data: tree,
    message: 'Organizational structure retrieved successfully',
  });
});

/**
 * createOrgUnitsForBranchAddressService
 * -----------------------------------------------------
 * Creates the complete hierarchical OrgUnit structure for a branch address.
 *
 * Parameters:
 *   - companyId: The ID of the company.
 *   - companyName: The company name (used for naming convention if desired).
 *   - officeName: The branch’s office name.
 *   - city: The branch's city.
 *   - subdivision: The region/state (if available).
 *   - country: The branch's country.
 *   - branchAddressId: The ObjectId of the created branch address.
 *
 * Returns:
 *   An object with the created/found OrgUnits: { countryUnit, regionUnit, cityUnit, branchUnit }.
 */
export const createOrgUnitsForBranchAddressService = async ({
  companyId,
  companyName,
  officeName,
  city,
  subdivision,
  country,
  branchAddressId,
}) => {
  // Validate input parameters.
  if (!companyId || !companyName || !officeName || !city || !country || !branchAddressId) {
    throw new ApiError(400, 'Missing required parameters for creating OrgUnits');
  }

  let countryUnit, regionUnit, cityUnit, branchUnit;

  try {
    // --- Country Level ---

    const countryName = country.trim();
    countryUnit = await OrgUnit.findOne({ name: countryName, type: 'Country', company: companyId });
    if (!countryUnit) {
      countryUnit = await OrgUnit.create({
        name: countryName,
        type: 'Country',
        parent: null,
        company: companyId,
      });
    }

    // --- Region Level (Optional) ---
    let regionName = subdivision && subdivision.trim() !== '' ? subdivision.trim() : null;
    if (regionName) {
      regionUnit = await OrgUnit.findOne({
        name: regionName,
        type: 'Region',
        parent: countryUnit._id,
        company: companyId,
      });
      if (!regionUnit) {
        regionUnit = await OrgUnit.create({
          name: regionName,
          type: 'Region',
          parent: countryUnit._id,
          company: companyId,
        });
      }
    }

    // --- City Level ---
    const cityName = city.trim();
    const parentForCity = regionUnit ? regionUnit._id : countryUnit._id;
    cityUnit = await OrgUnit.findOne({
      name: cityName,
      type: 'City',
      parent: parentForCity,
      company: companyId,
    });
    if (!cityUnit) {
      cityUnit = await OrgUnit.create({
        name: cityName,
        type: 'City',
        parent: parentForCity,
        company: companyId,
      });
    }

    // --- Branch Level ---
    // For branch, we store the branchAddress reference as well.
    const branchUnitName = officeName.trim();
    branchUnit = await OrgUnit.findOne({
      name: branchUnitName,
      type: 'Branch',
      parent: cityUnit._id,
      company: companyId,
    });
    if (!branchUnit) {
      branchUnit = await OrgUnit.create({
        name: branchUnitName,
        type: 'Branch',
        parent: cityUnit._id,
        branchAddress: branchAddressId.toString(),
        company: companyId,
      });
    }
  } catch (error) {
    throw new ApiError(500, 'Error processing OrgUnits: ' + error.message);
  }

  return { countryUnit, regionUnit, cityUnit, branchUnit };
};

/**
 * createOrgUnitsForBranchAddress
 * -------------------------------------------
 * Express endpoint to create the organizational hierarchy for a branch.
 * Expects: companyId, companyName, officeName, city, subdivision, country, branchAddressId in req.body.
 */
export const createOrgUnitsForBranchAddress = asyncHandler(async (req, res) => {
  const { companyId, companyName, officeName, city, subdivision, country, branchAddressId } =
    req.body;
  if (!companyId || !companyName || !officeName || !city || !country || !branchAddressId) {
    throw new ApiError(
      400,
      'Company ID, company name, office name, city, country, and branchAddressId are required.',
    );
  }
  const orgUnits = await createOrgUnitsForBranchAddressService({
    companyId,
    companyName,
    officeName,
    city,
    subdivision,
    country,
    branchAddressId,
  });
  return res.status(201).json({
    success: true,
    data: orgUnits,
    message: 'Organizational hierarchy for branch created successfully',
  });
});

/**
 * getOrgUnitsByType
 * -------------------------------------------
 * Retrieves OrgUnits filtered by type and (optionally) by company.
 * For Branch type, it will also populate branchAddress and filter based on associated company.
 * For hierarchical types (Country, Region, City), it uses the company field to filter.
 */
export const getOrgUnitsByType = asyncHandler(async (req, res) => {
  const { type, companyId } = req.query;
  if (!type) {
    throw new ApiError(400, 'OrgUnit type query parameter is required');
  }

  let units;
  try {
    // If type is Branch and companyId is provided, we can filter directly by the company field.
    if (type.trim() === 'Branch' && companyId) {
      units = await OrgUnit.find({ type: 'Branch', company: companyId })
        .populate({
          path: 'branchAddress',
          // Ensure the branchAddress matches the company (if needed)
          match: { associatedCompany: companyId },
        })
        .lean();
      // Remove any records without a populated branchAddress.
      units = units.filter((unit) => unit.branchAddress);
    } else if (companyId && ['Country', 'Region', 'City'].includes(type.trim())) {
      // For hierarchical types, filter directly by type and company.
      units = await OrgUnit.find({ type: type.trim(), company: companyId })
        .populate('parent')
        .lean();
    } else {
      // For other cases, fetch by type regardless of company.
      units = await OrgUnit.find({ type: type.trim() }).populate('branchAddress').lean();
    }
  } catch (error) {
    throw new ApiError(500, 'Error retrieving OrgUnits: ' + error.message);
  }

  return res
    .status(200)
    .json({ success: true, data: units, message: 'OrgUnits retrieved successfully' });
});

/**
 * GET /api/v1/orgUnits/grouped
 * Returns distinct OrgUnits grouped by their type.
 * For OrgUnits of type "Branch", only returns those where the associated BranchAddress (via lookup)
 * has an associatedCompany matching the provided companyId.
 * Logs inputs and outputs for debugging.
 */
export const getGroupedOrgUnits = asyncHandler(async (req, res) => {
  const { companyId } = req.query;
  console.log('[getGroupedOrgUnits] Called with companyId:', companyId);
  let groupedData;
  try {
    if (companyId) {
      if (!mongoose.Types.ObjectId.isValid(companyId)) {
        console.error('[getGroupedOrgUnits] Invalid companyId:', companyId);
        throw new ApiError(400, 'Invalid companyId format');
      }
      groupedData = await OrgUnit.aggregate([
        {
          $lookup: {
            from: 'branchaddresses', // Ensure this matches your actual collection name
            localField: 'branchAddress',
            foreignField: '_id',
            as: 'branchInfo',
          },
        },
        { $unwind: { path: '$branchInfo', preserveNullAndEmptyArrays: true } },
        {
          $match: {
            $or: [
              { type: { $ne: 'Branch' } },
              { 'branchInfo.associatedCompany': new mongoose.Types.ObjectId(companyId) },
            ],
          },
        },
        {
          $group: {
            _id: { type: '$type', name: '$name' },
            orgUnit: { $first: '$$ROOT' },
          },
        },
        {
          $group: {
            _id: '$_id.type',
            units: { $push: '$orgUnit' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      // console.log(
      //   '[getGroupedOrgUnits] Grouped data (with companyId):',
      //   JSON.stringify(groupedData, null, 2),
      // );
    } else {
      groupedData = await OrgUnit.aggregate([
        {
          $group: {
            _id: { type: '$type', name: '$name' },
            orgUnit: { $first: '$$ROOT' },
          },
        },
        {
          $group: {
            _id: '$_id.type',
            units: { $push: '$orgUnit' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      console.log(
        '[getGroupedOrgUnits] Grouped data (without companyId):',
        JSON.stringify(groupedData, null, 2),
      );
    }
    return res
      .status(200)
      .json(new ApiResponse(200, groupedData, 'Grouped OrgUnits retrieved successfully'));
  } catch (error) {
    console.error('[getGroupedOrgUnits] Error:', error);
    throw new ApiError(500, 'Error retrieving grouped OrgUnits: ' + error.message);
  }
});
