import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import mongoose from 'mongoose';

/**
 * GET /api/v1/analytics/offices
 *
 * Retrieves a list of offices (branch addresses) along with computed metrics.
 *
 * Query parameters:
 *   - companyId (optional): If provided and no orgUnitId, returns offices for that company.
 *   - orgUnitId (optional): If provided, returns offices filtered based on the OrgUnit.
 *
 * Filtering logic:
 *   - If orgUnitId is provided:
 *       • For OrgUnit type "Branch": filter BranchAddress by matching _id with OrgUnit.branchAddress.
 *       • For "City": filter where city equals OrgUnit.name.
 *       • For "Country": filter where country equals OrgUnit.name.
 *       • For "Region" or "State": filter where subdivision equals OrgUnit.name.
 *   - Else if only companyId is provided, filter BranchAddress by associatedCompany.
 *
 * Aggregation pipeline:
 *   1. Match BranchAddress documents based on the filter (only active branches).
 *   2. Lookup associated dustbins.
 *   3. Unwind the dustbins array (preserving empty arrays).
 *   4. For each bin, lookup the latest waste record from the "wastes" collection:
 *       - Match waste records whose associateBin equals the bin _id.
 *       - Sort by createdAt descending and limit to 1.
 *       - Project the currentWeight field.
 *   5. Unwind the resulting latestWaste array (preserving empty arrays).
 *   6. Add fields for each bin:
 *       - binWaste: The latest waste reading (defaults to 0 if none found).
 *       - binType: The bin’s type.
 *       - binCapacity: The bin’s capacity.
 *   7. Group by branch (_id) to:
 *       - Sum binWaste to compute totalWeight.
 *       - Sum binWaste for bins not labeled "General Waste" as diversionWeight.
 *       - Collect unique bin configurations in an array.
 *   8. Add computed fields:
 *       - location: A concatenated string of city, subdivision, and country.
 *       - diversion: Computed as (diversionWeight / totalWeight) * 100 (rounded to 2 decimals).
 */
export const getOffices = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId } = req.query;

  // Build base filter: only active (non-deleted) BranchAddress documents.
  let filter = { isdeleted: false };

  // Apply filtering based on orgUnitId if provided.
  if (orgUnitId) {
    const orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      throw new ApiError(404, 'OrgUnit not found');
    }
    switch (orgUnit.type) {
      case 'Branch':
        // For branch-type OrgUnits, filter where BranchAddress._id equals the stored branchAddress.
        if (orgUnit.branchAddress) {
          filter._id = orgUnit.branchAddress;
        } else {
          throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
        }
        break;
      case 'City':
        filter.city = orgUnit.name;
        break;
      case 'Country':
        filter.country = orgUnit.name;
        break;
      case 'Region':
      case 'State':
        filter.subdivision = orgUnit.name;
        break;
      default:
        // Other OrgUnit types can be handled here if necessary.
        break;
    }
  } else if (companyId) {
    // If no orgUnitId is provided but companyId is, filter by associatedCompany.
    filter.associatedCompany = new mongoose.Types.ObjectId(companyId);
  }

  try {
    const offices = await BranchAddress.aggregate([
      { $match: filter },
      // Lookup associated dustbins for each branch.
      {
        $lookup: {
          from: 'dustbins',
          localField: '_id',
          foreignField: 'branchAddress',
          as: 'bins',
        },
      },
      // Unwind the bins array (while preserving documents with no bins).
      { $unwind: { path: '$bins', preserveNullAndEmptyArrays: true } },
      // For each bin, lookup the latest waste record.
      {
        $lookup: {
          from: 'wastes',
          let: { binId: '$bins._id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$associateBin', '$$binId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { currentWeight: 1, _id: 0 } },
          ],
          as: 'latestWaste',
        },
      },
      // Unwind the latestWaste array (preserving cases where no waste record is found).
      { $unwind: { path: '$latestWaste', preserveNullAndEmptyArrays: true } },
      // Add fields for the latest waste reading and bin information.
      {
        $addFields: {
          binWaste: { $ifNull: ['$latestWaste.currentWeight', 0] },
          binType: '$bins.dustbinType',
          binCapacity: '$bins.binCapacity',
        },
      },
      // Group by branch to aggregate waste data and collect bins.
      {
        $group: {
          _id: '$_id',
          officeName: { $first: '$officeName' },
          address: { $first: '$address' },
          city: { $first: '$city' },
          subdivision: { $first: '$subdivision' },
          country: { $first: '$country' },
          associatedCompany: { $first: '$associatedCompany' },
          totalWeight: { $sum: '$binWaste' },
          diversionWeight: {
            $sum: {
              $cond: [{ $ne: ['$binType', 'General Waste'] }, '$binWaste', 0],
            },
          },
          bins: {
            $addToSet: {
              _id: '$bins._id',
              dustbinType: '$bins.dustbinType',
              binCapacity: '$bins.binCapacity',
            },
          },
        },
      },
      // Add computed fields: location and diversion percentage.
      {
        $addFields: {
          location: { $concat: ['$city', ', ', '$subdivision', ', ', '$country'] },
          diversion: {
            $cond: [
              { $gt: ['$totalWeight', 0] },
              {
                $round: [
                  { $multiply: [{ $divide: ['$diversionWeight', '$totalWeight'] }, 100] },
                  2,
                ],
              },
              0,
            ],
          },
        },
      },
    ]);

    if (!offices || offices.length === 0) {
      return res.status(200).json(new ApiResponse(200, [], 'No offices found'));
    }
    return res.status(200).json(new ApiResponse(200, offices, 'Offices retrieved successfully'));
  } catch (error) {
    throw new ApiError(500, 'Error retrieving offices: ' + error.message);
  }
});
