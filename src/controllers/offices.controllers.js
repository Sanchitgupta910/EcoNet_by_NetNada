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
//           as: 'bins',
//         },
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
//                   $eq: ['$associateBin', '$$binId'],
//                 },
//               },
//             },
//             { $sort: { createdAt: -1 } },
//             { $limit: 1 },
//             { $project: { currentWeight: 1, createdAt: 1, _id: 0 } },
//           ],
//           as: 'latestWaste',
//         },
//       },
//       { $unwind: { path: '$latestWaste', preserveNullAndEmptyArrays: true } },
//       {
//         $addFields: {
//           binWaste: { $ifNull: ['$latestWaste.currentWeight', 0] },
//           binType: { $ifNull: ['$bins.dustbinType', ''] },
//           binCapacity: { $ifNull: ['$bins.binCapacity', 0] },
//         },
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
//             $sum: { $cond: [{ $ne: ['$binType', 'General Waste'] }, '$binWaste', 0] },
//           },
//           bins: {
//             $push: {
//               _id: '$bins._id',
//               dustbinType: '$bins.dustbinType',
//               binCapacity: '$bins.binCapacity',
//             },
//           },
//         },
//       },
//       {
//         $addFields: {
//           location: { $concat: ['$city', ', ', '$subdivision', ', ', '$country'] },
//           diversion: {
//             $cond: [
//               { $gt: ['$totalWeight', 0] },
//               {
//                 $round: [
//                   { $multiply: [{ $divide: ['$diversionWeight', '$totalWeight'] }, 100] },
//                   2,
//                 ],
//               },
//               0,
//             ],
//           },
//         },
//       },
//     ]);

//     // console.log("Debug: Aggregated offices data:");
//     // offices.forEach(office => {
//     //   console.log(`Office: ${office.officeName || 'N/A'} | Total Waste: ${office.totalWeight} | Diversion: ${office.diversion}%`);
//     // });

//     return res
//       .status(200)
//       .json(new ApiResponse(200, offices, 'Offices retrieved successfully (debug mode)'));
//   } catch (error) {
//     throw new ApiError(500, 'Error retrieving offices (debug mode): ' + error.message);
//   }
// });

import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { BranchAddress } from '../models/branchAddress.models.js';

export const getOffices = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId } = req.query;

  // Build a branch filter based on companyId or orgUnitId
  let branchFilter = { isdeleted: false };

  if (orgUnitId) {
    const orgUnit = await require('../models/orgUnit.model.js').OrgUnit.findById(orgUnitId).lean();
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

  try {
    // Optimized pipeline:
    // 1. Match BranchAddress using our branchFilter.
    // 2. Lookup all dustbins for each branch.
    // 3. Lookup, in one call per branch, the latest waste for each bin in that branch.
    // 4. Use $map to merge the latest waste values into each bin.
    // 5. Compute branch-level totals.
    const offices = await BranchAddress.aggregate([
      { $match: branchFilter },
      // Join dustbins belonging to each branch.
      {
        $lookup: {
          from: 'dustbins',
          localField: '_id',
          foreignField: 'branchAddress',
          as: 'bins',
        },
      },
      // Lookup latest waste record per dustbin for all bins in this branch.
      {
        $lookup: {
          from: 'wastes',
          let: { binIds: '$bins._id' },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$associateBin', '$$binIds'] },
              },
            },
            { $sort: { createdAt: -1 } },
            // Group by associateBin to choose the latest waste record.
            {
              $group: {
                _id: '$associateBin',
                latestWeight: { $first: '$currentWeight' },
              },
            },
          ],
          as: 'wasteInfo',
        },
      },
      // Attach latest waste to each bin in the bins array.
      {
        $addFields: {
          bins: {
            $map: {
              input: '$bins',
              as: 'bin',
              in: {
                _id: '$$bin._id',
                dustbinType: '$$bin.dustbinType',
                binCapacity: '$$bin.binCapacity',
                // Find matching waste record from wasteInfo array.
                binWaste: {
                  $let: {
                    vars: {
                      match: {
                        $filter: {
                          input: '$wasteInfo',
                          as: 'w',
                          cond: { $eq: ['$$w._id', '$$bin._id'] },
                        },
                      },
                    },
                    in: { $ifNull: [{ $arrayElemAt: ['$$match.latestWeight', 0] }, 0] },
                  },
                },
              },
            },
          },
        },
      },
      // Calculate branch-level totals.
      {
        $addFields: {
          totalWeight: { $sum: '$bins.binWaste' },
          diversionWeight: {
            $sum: {
              $map: {
                input: '$bins',
                as: 'b',
                in: {
                  $cond: [{ $ne: ['$$b.dustbinType', 'General Waste'] }, '$$b.binWaste', 0],
                },
              },
            },
          },
        },
      },
      // Group final fields (each branch is one document)
      {
        $project: {
          officeName: 1,
          city: 1,
          subdivision: 1,
          country: 1,
          location: { $concat: ['$city', ', ', '$subdivision', ', ', '$country'] },
          totalWeight: 1,
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
          bins: 1,
        },
      },
    ]).option({ allowDiskUse: true });

    return res.status(200).json(new ApiResponse(200, offices, 'Offices retrieved successfully'));
  } catch (error) {
    throw new ApiError(500, 'Error retrieving offices: ' + error.message);
  }
});
