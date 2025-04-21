import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import { getUTCDayRange } from './SuperAdminAnalytics.controllers.js';
import { getDateRangeFromFilterUTC } from './SuperAdminAnalytics.controllers.js';
import { getPreviousDateRange } from './SuperAdminAnalytics.controllers.js';
import { Dustbin } from '../models/dustbin.models.js';
/**
 * buildBranchIdsForLocalAdmin
 * Given the logged-in user's OrgUnit and company, returns an array of branch IDs
 * (from the BranchAddress collection) that the user is permitted to access.
 */
const buildBranchIdsForLocalAdmin = async (userOrgUnit, companyId) => {
  // Base query: restrict to the user's company.
  const query = { associatedCompany: companyId, isdeleted: false };

  if (userOrgUnit && userOrgUnit.type) {
    switch (userOrgUnit.type) {
      case 'Branch':
        if (userOrgUnit.branchAddress) {
          // For a Branch admin, we restrict to that branch only.
          query._id = userOrgUnit.branchAddress;
        }
        break;
      case 'City':
        // City admin: filter branches by city (exact match).
        query.city = userOrgUnit.name;
        break;
      case 'Country':
        // Country admin: filter branches by country.
        query.country = userOrgUnit.name;
        break;
      case 'Region':
      case 'State':
        // Region/State admin: filter branches by subdivision.
        query.subdivision = userOrgUnit.name;
        break;
      default:
        break;
    }
  }
  const branches = await BranchAddress.find(query).select('_id').lean();
  return branches.map((b) => b._id);
};

/**
 * commonLatestWastePerBin
 * Aggregates latest waste readings per bin (per day) for the given branch IDs and date range.
 */
const commonLatestWastePerBin = async (rangeStart, rangeEnd, branchIds) => {
  const pipeline = [
    { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: {
          bin: '$associateBin',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
        latestWeight: { $first: '$currentWeight' },
      },
    },
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id.bin',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
    {
      $addFields: { dustbinType: '$binDetails.dustbinType' },
    },
    {
      $project: {
        _id: 0,
        associateBin: '$_id.bin',
        day: '$_id.day',
        latestWeight: 1,
        dustbinType: 1,
      },
    },
  ];
  return await Waste.aggregate(pipeline, { allowDiskUse: true });
};

/* ================================================================
     LOCAL ADMIN ENDPOINTS
     (For Country, City, Region/State, and Branch Admins)
  =================================================================== */

/**
 * getAdminOverview
 * GET /api/v1/analytics/adminOverview
 *
 * Returns an overview of key metrics for the branches that the local admin is allowed to see.
 * Uses today's data (latest reading per bin) to compute:
 *   - totalBins (from Dustbin)
 *   - totalWaste (summed from latest readings per bin)
 *   - landfillDiversionPercentage computed as:
 *         (Sum of latest readings from bins that are not "General Waste") / totalWaste * 100
 *   - Plus trend metrics comparing to a previous period.
 */
const getAdminOverview = asyncHandler(async (req, res) => {
  // Logged-in user details (set by verifyJWT)
  const loggedInUser = req.user;
  if (!loggedInUser) throw new ApiError(401, 'User not authenticated');

  const { orgUnitId, filter } = req.query;
  const now = new Date();
  // Use the provided filter for current period; default to "today" if not provided.
  const currentFilter = filter || 'today';
  const { startDate, endDate } = getDateRangeFromFilterUTC(currentFilter, now);
  // For previous period, use yesterday for "today" filter or a similar fallback.
  const { startDate: prevStart, endDate: prevEnd } =
    currentFilter === 'today'
      ? getUTCDayRange(new Date(now.getTime() - 24 * 60 * 60 * 1000))
      : getUTCDayRange(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  // Build branch IDs for the local admin
  const branchIds = await buildBranchIdsForLocalAdmin(loggedInUser.OrgUnit, loggedInUser.company);
  if (!branchIds.length) {
    const overviewData = {
      totalBins: 0,
      totalWaste: 0,
      landfillDiversionPercentage: 0,
      totalWasteTrend: 0,
      landfillDiversionTrend: 0,
    };
    return res
      .status(200)
      .json(new ApiResponse(200, overviewData, 'No branches found for your access level'));
  }

  // Compute total bins for branches accessible to the local admin.
  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

  // Retrieve today's latest readings per bin.
  const latestRecords = await commonLatestWastePerBin(startDate, endDate, branchIds);
  const totalWaste = latestRecords.reduce((sum, r) => sum + r.latestWeight, 0);
  const divertedTotal = latestRecords.reduce(
    (sum, r) => (r.dustbinType !== 'General Waste' ? sum + r.latestWeight : sum),
    0,
  );
  const currentDiversionPercentage =
    totalWaste > 0 ? Number(((divertedTotal / totalWaste) * 100).toFixed(2)) : 0;

  // Get previous period total similarly.
  const prevRecords = await commonLatestWastePerBin(prevStart, prevEnd, branchIds);
  const prevTotalWaste = prevRecords.reduce((sum, r) => sum + r.latestWeight, 0);
  const prevDiverted = prevRecords.reduce(
    (sum, r) => (r.dustbinType !== 'General Waste' ? sum + r.latestWeight : sum),
    0,
  );
  const totalWasteTrend =
    prevTotalWaste > 0
      ? Number((((totalWaste - prevTotalWaste) / prevTotalWaste) * 100).toFixed(2))
      : 0;
  const landfillDiversionTrend =
    prevDiverted > 0
      ? Number((((divertedTotal - prevDiverted) / prevDiverted) * 100).toFixed(2))
      : 0;

  const overviewData = {
    totalBins,
    totalWaste,
    landfillDiversionPercentage: currentDiversionPercentage,
    totalWasteTrend,
    landfillDiversionTrend,
  };
  return res
    .status(200)
    .json(new ApiResponse(200, overviewData, 'Admin overview data fetched successfully'));
});

/**
 * getWasteTrendChart
 * GET /api/v1/analytics/wasteTrendChart
 *
 * Returns time-series data for waste collection visible to the local admin.
 * Aggregates by hour if filter is "today" and by day for other filters.
 * Data is pivoted by bin type.
 */
const getWasteTrendChart = asyncHandler(async (req, res) => {
  const { filter, zoomDate } = req.query;
  const currentFilter = filter || 'today';
  const loggedInUser = req.user;
  if (!loggedInUser) throw new ApiError(401, 'User not authenticated');

  // Build branch IDs based on local admin's OrgUnit.
  const branchIds = await buildBranchIdsForLocalAdmin(loggedInUser.OrgUnit, loggedInUser.company);
  if (!branchIds.length) {
    return res
      .status(200)
      .json(new ApiResponse(200, [], 'No branches found for your access level'));
  }
  const now = new Date();
  let startDateVal, endDateVal;
  let isHourly = false;
  if (currentFilter === 'today' || zoomDate) {
    if (zoomDate) {
      const zDate = new Date(zoomDate);
      if (isNaN(zDate)) throw new ApiError(400, 'Invalid zoomDate format');
      ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(zDate));
    } else {
      ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(now));
    }
    isHourly = true;
  } else {
    ({ startDate: startDateVal, endDate: endDateVal } = getDateRangeFromFilterUTC(
      currentFilter,
      now,
    ));
  }

  // Build aggregation pipeline.
  const pipeline = [
    { $match: { createdAt: { $gte: startDateVal, $lte: endDateVal } } },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $lookup: {
        from: 'dustbins',
        let: { binId: '$associateBin' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ['$_id', '$$binId'] }, { $in: ['$branchAddress', branchIds] }],
              },
            },
          },
          { $project: { dustbinType: 1 } },
        ],
        as: 'binDetails',
      },
    },
    { $match: { binDetails: { $ne: [] } } },
  ];

  if (isHourly) {
    pipeline.push({ $addFields: { hour: { $hour: '$createdAt' } } });
    pipeline.push({
      $group: {
        _id: {
          bin: '$associateBin',
          hour: '$hour',
          binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
        },
        latestWeight: { $first: '$currentWeight' },
      },
    });
    pipeline.push({
      $group: {
        _id: { hour: '$_id.hour', binType: '$_id.binType' },
        totalWeight: { $sum: '$latestWeight' },
      },
    });
    pipeline.push({
      $group: {
        _id: '$_id.hour',
        bins: { $push: { k: '$_id.binType', v: '$totalWeight' } },
      },
    });
    pipeline.push({
      $project: {
        time: '$_id',
        _id: 0,
        data: { $arrayToObject: '$bins' },
      },
    });
    pipeline.push({ $sort: { time: 1 } });
  } else {
    pipeline.push({
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
      },
    });
    pipeline.push({ $sort: { associateBin: 1, createdAt: -1 } });
    pipeline.push({
      $group: {
        _id: {
          bin: '$associateBin',
          day: '$day',
          binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
        },
        latestWeight: { $first: '$currentWeight' },
      },
    });
    pipeline.push({
      $group: {
        _id: { day: '$_id.day', binType: '$_id.binType' },
        totalWeight: { $sum: '$latestWeight' },
      },
    });
    pipeline.push({
      $group: {
        _id: '$_id.day',
        bins: { $push: { k: '$_id.binType', v: '$totalWeight' } },
      },
    });
    pipeline.push({
      $project: {
        time: '$_id',
        _id: 0,
        data: { $arrayToObject: '$bins' },
      },
    });
    pipeline.push({ $sort: { time: 1 } });
  }

  const result = await Waste.aggregate(pipeline, { allowDiskUse: true });
  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Waste trend chart data retrieved successfully'));
});

/**
 * getWasteDispositionRates
 * GET /api/v1/analytics/wasteDispositionRates
 *
 * Returns time-series data for an area chart comparing:
 *  - Landfill Waste: Sum of latest readings for bins of type "General Waste"
 *  - Diverted Waste: Sum of latest readings for bins of other types
 * Uses hourly aggregation for "today" and daily aggregation for other filters.
 */
const getWasteDispositionRates = asyncHandler(async (req, res) => {
  const { filter } = req.query;
  const loggedInUser = req.user;
  if (!loggedInUser) throw new ApiError(401, 'User not authenticated');

  // Build branch IDs.
  const branchIds = await buildBranchIdsForLocalAdmin(loggedInUser.OrgUnit, loggedInUser.company);
  if (!branchIds.length) {
    return res
      .status(200)
      .json(new ApiResponse(200, [], 'No branches found for your access level'));
  }
  const now = new Date();
  let startDateVal, endDateVal;
  let isHourly = false;
  if (filter === 'today') {
    ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(now));
    isHourly = true;
  } else {
    ({ startDate: startDateVal, endDate: endDateVal } = getDateRangeFromFilterUTC(filter, now));
  }

  const pipeline = [
    { $match: { createdAt: { $gte: startDateVal, $lte: endDateVal } } },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $lookup: {
        from: 'dustbins',
        let: { binId: '$associateBin' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ['$_id', '$$binId'] }, { $in: ['$branchAddress', branchIds] }],
              },
            },
          },
          { $project: { dustbinType: 1 } },
        ],
        as: 'binDetails',
      },
    },
    { $match: { binDetails: { $ne: [] } } },
  ];

  if (isHourly) {
    pipeline.push({ $addFields: { hour: { $hour: '$createdAt' } } });
    pipeline.push({
      $group: {
        _id: {
          bin: '$associateBin',
          hour: '$hour',
          binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
        },
        latestWeight: { $first: '$currentWeight' },
      },
    });
    pipeline.push({
      $addFields: {
        landfillWaste: {
          $cond: [{ $eq: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
        },
        divertedWaste: {
          $cond: [{ $ne: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
        },
      },
    });
    pipeline.push({
      $group: {
        _id: '$_id.hour',
        totalLandfill: { $sum: '$landfillWaste' },
        totalDiverted: { $sum: '$divertedWaste' },
      },
    });
    pipeline.push({
      $project: {
        time: '$_id',
        _id: 0,
        landfillWaste: '$totalLandfill',
        divertedWaste: '$totalDiverted',
      },
    });
    pipeline.push({ $sort: { time: 1 } });
  } else {
    pipeline.push({
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
      },
    });
    pipeline.push({ $sort: { associateBin: 1, createdAt: -1 } });
    pipeline.push({
      $group: {
        _id: {
          bin: '$associateBin',
          day: '$day',
          binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
        },
        latestWeight: { $first: '$currentWeight' },
      },
    });
    pipeline.push({
      $addFields: {
        landfillWaste: {
          $cond: [{ $eq: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
        },
        divertedWaste: {
          $cond: [{ $ne: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
        },
      },
    });
    pipeline.push({
      $group: {
        _id: '$_id.day',
        totalLandfill: { $sum: '$landfillWaste' },
        totalDiverted: { $sum: '$divertedWaste' },
      },
    });
    pipeline.push({
      $project: {
        time: '$_id',
        _id: 0,
        landfillWaste: '$totalLandfill',
        divertedWaste: '$totalDiverted',
      },
    });
    pipeline.push({ $sort: { time: 1 } });
  }

  const result = await Waste.aggregate(pipeline, { allowDiskUse: true });
  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Waste disposition rates retrieved successfully'));
});

export { getAdminOverview, getWasteTrendChart, getWasteDispositionRates };
