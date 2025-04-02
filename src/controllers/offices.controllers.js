// import { asyncHandler } from '../utils/asyncHandler.js';
// import { ApiError } from '../utils/ApiError.js';
// import { ApiResponse } from '../utils/ApiResponse.js';
// import { BranchAddress } from '../models/branchAddress.models.js';
// import { OrgUnit } from '../models/orgUnit.model.js';
// import mongoose from 'mongoose';

// export const getOffices = asyncHandler(async (req, res) => {
//   const { companyId, orgUnitId } = req.query;

//   // Using the original active flag field (as stored in your DB)
//   let branchFilter = { isdeleted: false };

//   if (orgUnitId) {
//     const orgUnit = await OrgUnit.findById(orgUnitId).lean();
//     if (!orgUnit) throw new ApiError(404, 'OrgUnit not found');
//     switch (orgUnit.type) {
//       case 'Branch':
//         if (orgUnit.branchAddress) branchFilter._id = orgUnit.branchAddress;
//         else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
//         break;
//       case 'City':
//         branchFilter.city = orgUnit.name;
//         break;
//       case 'Country':
//         branchFilter.country = orgUnit.name;
//         break;
//       case 'Region':
//       case 'State':
//         branchFilter.subdivision = orgUnit.name;
//         break;
//       default:
//         break;
//     }
//   } else if (companyId) {
//     branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
//   }

//   try {
//     const offices = await BranchAddress.aggregate([
//       { $match: branchFilter },
//       {
//         $lookup: {
//           from: 'dustbins',
//           localField: '_id',
//           foreignField: 'branchAddress',
//           as: 'bins'
//         }
//       },
//       { $unwind: { path: '$bins', preserveNullAndEmptyArrays: true } },
//       // Debug lookup: Remove the date filter entirely.
//       {
//         $lookup: {
//           from: 'wastes',
//           let: { binId: '$bins._id' },
//           pipeline: [
//             {
//               $match: {
//                 $expr: {
//                   $eq: [ "$associateBin", "$$binId" ]
//                 }
//               }
//             },
//             { $sort: { createdAt: -1 } },
//             { $limit: 1 },
//             { $project: { currentWeight: 1, createdAt: 1, _id: 0 } }
//           ],
//           as: 'latestWaste'
//         }
//       },
//       { $unwind: { path: '$latestWaste', preserveNullAndEmptyArrays: true } },
//       {
//         $addFields: {
//           binWaste: { $ifNull: ['$latestWaste.currentWeight', 0] },
//           binType: { $ifNull: ['$bins.dustbinType', ''] },
//           binCapacity: { $ifNull: ['$bins.binCapacity', 0] }
//         }
//       },
//       {
//         $group: {
//           _id: '$_id',
//           officeName: { $first: '$officeName' },
//           city: { $first: '$city' },
//           subdivision: { $first: '$subdivision' },
//           country: { $first: '$country' },
//           totalWeight: { $sum: '$binWaste' },
//           diversionWeight: {
//             $sum: { $cond: [{ $ne: ['$binType', 'General Waste'] }, '$binWaste', 0] }
//           },
//           bins: { $push: {
//               _id: '$bins._id',
//               dustbinType: '$bins.dustbinType',
//               binCapacity: '$bins.binCapacity'
//           } }
//         }
//       },
//       {
//         $addFields: {
//           location: { $concat: ['$city', ', ', '$subdivision', ', ', '$country'] },
//           diversion: {
//             $cond: [
//               { $gt: ['$totalWeight', 0] },
//               { $round: [{ $multiply: [{ $divide: ['$diversionWeight', '$totalWeight'] }, 100] }, 2] },
//               0
//             ]
//           }
//         }
//       }
//     ]);

//     // console.log("Debug: Aggregated offices data:");
//     // offices.forEach(office => {
//     //   console.log(`Office: ${office.officeName || 'N/A'} | Total Waste: ${office.totalWeight} | Diversion: ${office.diversion}%`);
//     // });

//     return res.status(200).json(new ApiResponse(200, offices, 'Offices retrieved successfully (debug mode)'));
//   } catch (error) {
//     throw new ApiError(500, 'Error retrieving offices (debug mode): ' + error.message);
//   }
// });
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import mongoose from 'mongoose';

/**
 * getOffices
 * GET /api/v1/analytics/offices
 *
 * Retrieves office data (BranchAddress) with additional information.
 *
 * - For SuperAdmin users, explicit query parameters (companyId and/or orgUnitId) can be used.
 * - For all other users, the results are restricted based on the logged-in user's company and OrgUnit.
 *   Depending on the OrgUnit type:
 *     • Branch admin: Only the branch whose _id matches OrgUnit.branchAddress.
 *     • City admin: Only branches where BranchAddress.city exactly equals OrgUnit.name.
 *     • Country admin: Only branches where BranchAddress.country exactly equals OrgUnit.name.
 *     • Region/State admin: Only branches where BranchAddress.subdivision exactly equals OrgUnit.name.
 */
export const getOffices = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId } = req.query;
  let branchFilter = { isdeleted: false };

  // If the user is logged in and is not a SuperAdmin, restrict results based on their OrgUnit.
  if (req.user && req.user.role !== 'SuperAdmin') {
    // Force the user's company.
    branchFilter.associatedCompany = req.user.company;
    const userOrgUnit = req.user.OrgUnit;
    if (userOrgUnit && userOrgUnit.type) {
      // Apply filters based on the OrgUnit type.
      switch (userOrgUnit.type) {
        case 'Branch':
          if (userOrgUnit.branchAddress) {
            branchFilter._id = new mongoose.Types.ObjectId(userOrgUnit.branchAddress);
          }
          break;
        case 'City':
          branchFilter.city = userOrgUnit.name;
          break;
        case 'Country':
          branchFilter.country = userOrgUnit.name;
          break;
        case 'Region':
        case 'State':
          branchFilter.subdivision = userOrgUnit.name;
          break;
        default:
          break;
      }
    }
  } else {
    // For SuperAdmin users, use explicit query parameters if provided.
    if (orgUnitId) {
      const orgUnit = await OrgUnit.findById(orgUnitId).lean();
      if (!orgUnit) throw new ApiError(404, 'OrgUnit not found');
      switch (orgUnit.type) {
        case 'Branch':
          if (orgUnit.branchAddress) branchFilter._id = orgUnit.branchAddress;
          else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
          break;
        case 'City':
          branchFilter.city = orgUnit.name;
          break;
        case 'Country':
          branchFilter.country = orgUnit.name;
          break;
        case 'Region':
        case 'State':
          branchFilter.subdivision = orgUnit.name;
          break;
        default:
          break;
      }
    } else if (companyId) {
      branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
    }
    // If no explicit filter is provided, no additional restrictions are applied.
  }

  try {
    // Use aggregation to fetch offices with additional bin and waste data.
    const offices = await BranchAddress.aggregate([
      { $match: branchFilter },
      {
        $lookup: {
          from: 'dustbins',
          localField: '_id',
          foreignField: 'branchAddress',
          as: 'bins',
        },
      },
      { $unwind: { path: '$bins', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'wastes',
          let: { binId: '$bins._id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$associateBin', '$$binId'] },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { currentWeight: 1, createdAt: 1, _id: 0 } },
          ],
          as: 'latestWaste',
        },
      },
      { $unwind: { path: '$latestWaste', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          binWaste: { $ifNull: ['$latestWaste.currentWeight', 0] },
          binType: { $ifNull: ['$bins.dustbinType', ''] },
          binCapacity: { $ifNull: ['$bins.binCapacity', 0] },
        },
      },
      {
        $group: {
          _id: '$_id',
          officeName: { $first: '$officeName' },
          city: { $first: '$city' },
          subdivision: { $first: '$subdivision' },
          country: { $first: '$country' },
          totalWeight: { $sum: '$binWaste' },
          diversionWeight: {
            $sum: { $cond: [{ $ne: ['$binType', 'General Waste'] }, '$binWaste', 0] },
          },
          bins: {
            $push: {
              _id: '$bins._id',
              dustbinType: '$bins.dustbinType',
              binCapacity: '$bins.binCapacity',
            },
          },
        },
      },
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

    return res.status(200).json(new ApiResponse(200, offices, 'Offices retrieved successfully'));
  } catch (error) {
    throw new ApiError(500, 'Error retrieving offices: ' + error.message);
  }
});
