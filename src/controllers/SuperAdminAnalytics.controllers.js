import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
} from 'date-fns';

/**
 * Helper: Returns start and end of the day in UTC.
 */
export const getUTCDayRange = (date) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const startDate = new Date(Date.UTC(year, month, day, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  return { startDate, endDate };
};

/**
 * getDateRangeFromFilterUTC:
 * Returns start and end dates based on filter ("today", "thisWeek", "thisMonth", "lastMonth")
 */
export const getDateRangeFromFilterUTC = (filter, now = new Date()) => {
  let startDate, endDate;
  switch (filter) {
    case 'today': {
      ({ startDate, endDate } = getUTCDayRange(now));
      break;
    }
    case 'thisWeek': {
      const dayOfWeek = now.getUTCDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + diffToMonday);
      startDate = new Date(
        Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0),
      );
      endDate = now;
      break;
    }
    case 'thisMonth': {
      startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
      endDate = now;
      break;
    }
    case 'lastMonth': {
      const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      startDate = new Date(
        Date.UTC(lastMonthDate.getUTCFullYear(), lastMonthDate.getUTCMonth(), 1, 0, 0, 0),
      );
      endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      break;
    }
    default: {
      ({ startDate, endDate } = getUTCDayRange(now));
      break;
    }
  }
  return { startDate, endDate };
};

/**
 * getPreviousDateRange:
 * Returns the previous period's date range based on the current filter.
 */
export const getPreviousDateRange = (filter, now = new Date()) => {
  let previousStartDate, previousEndDate;
  switch (filter) {
    case 'today': {
      const prev = new Date(now);
      prev.setUTCDate(now.getUTCDate() - 1);
      ({ startDate: previousStartDate, endDate: previousEndDate } = getUTCDayRange(prev));
      break;
    }
    case 'thisWeek': {
      const prev = new Date(now);
      prev.setUTCDate(now.getUTCDate() - 7);
      ({ startDate: previousStartDate, endDate: previousEndDate } = getUTCDayRange(prev));
      break;
    }
    case 'thisMonth': {
      const prev = new Date(now);
      prev.setUTCMonth(now.getUTCMonth() - 1);
      previousStartDate = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 1, 0, 0, 0));
      const dayOfNow = now.getUTCDate();
      const lastDayOfPrevMonth = new Date(
        Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      ).getUTCDate();
      const effectiveDay = Math.min(dayOfNow, lastDayOfPrevMonth);
      previousEndDate = new Date(
        Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), effectiveDay, 23, 59, 59, 999),
      );
      break;
    }
    case 'lastMonth': {
      const prev = new Date(now);
      prev.setUTCMonth(now.getUTCMonth() - 2);
      previousStartDate = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 1, 0, 0, 0));
      previousEndDate = new Date(
        Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      );
      break;
    }
    default: {
      const prev = new Date(now);
      prev.setUTCDate(now.getUTCDate() - 1);
      ({ startDate: previousStartDate, endDate: previousEndDate } = getUTCDayRange(prev));
      break;
    }
  }
  return { previousStartDate, previousEndDate };
};

/**
 * getLatestWastePerBin:
 * Returns an array of objects with the latest waste reading per bin per day.
 * Updated to sort first using the indexed fields, then group.
 */
const getLatestWastePerBin = async (rangeStart, rangeEnd, branchIds) => {
  const pipeline = [
    { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: {
          associateBin: '$associateBin',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
        latestWeight: { $first: '$currentWeight' },
      },
    },
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id.associateBin',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
    { $addFields: { dustbinType: '$binDetails.dustbinType' } },
    {
      $project: {
        _id: 0,
        associateBin: '$_id.associateBin',
        day: '$_id.day',
        latestWeight: 1,
        dustbinType: 1,
      },
    },
  ];
  const results = await Waste.aggregate(pipeline, { allowDiskUse: true });
  return results;
};

/**
 * getAdminOverview:
 * Computes admin-level metrics.
 */
const getAdminOverview = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId, filter } = req.query;
  const now = new Date();
  const { startDate, endDate } = getDateRangeFromFilterUTC(filter, now);
  let { previousStartDate, previousEndDate } = getPreviousDateRange(filter, now);

  // For the "lastMonth" filter, override the previous period to use the current month's range.
  // This makes the comparison "last month" (current period) compared to "this month" (previous period).
  if (filter === 'lastMonth') {
    previousStartDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    previousEndDate = now;
    console.log(
      `Overriding previous period for 'lastMonth': ${previousStartDate.toISOString()} to ${previousEndDate.toISOString()}`,
    );
  }

  let branchFilter = { isdeleted: false };
  if (companyId) branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
  if (orgUnitId) {
    let orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      const branch = await BranchAddress.findById(orgUnitId).lean();
      if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
      orgUnit = { _id: branch._id, type: 'Branch', branchAddress: branch._id };
    }
    switch (orgUnit.type) {
      case 'Branch':
        if (orgUnit.branchAddress)
          branchFilter._id = new mongoose.Types.ObjectId(orgUnit.branchAddress);
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
  }

  const branches = await BranchAddress.find(branchFilter).select('_id').lean();
  const branchIds = branches.map((b) => b._id);

  if (branchIds.length === 0) {
    const overviewData = {
      totalBins: 0,
      totalWaste: 0,
      landfillDiversionPercentage: 0,
      totalWasteTrend: 0,
      landfillDiversionTrend: 0,
    };
    return res
      .status(200)
      .json(new ApiResponse(200, overviewData, 'No branches found for the given filter'));
  }

  // Compute total bins.
  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

  // Get latest waste per bin for current period.
  const latestRecords = await getLatestWastePerBin(startDate, endDate, branchIds);
  const totalWaste = latestRecords.reduce((sum, record) => sum + record.latestWeight, 0);
  const landfillDiversion = latestRecords.reduce(
    (sum, record) => (record.dustbinType !== 'General Waste' ? sum + record.latestWeight : sum),
    0,
  );
  const currentDiversionPercentage =
    totalWaste > 0 ? Number(((landfillDiversion / totalWaste) * 100).toFixed(2)) : 0;

  // Get previous period records.
  const prevRecords = await getLatestWastePerBin(previousStartDate, previousEndDate, branchIds);
  const prevTotalWaste = prevRecords.reduce((sum, record) => sum + record.latestWeight, 0);
  const prevLandfillDiversion = prevRecords.reduce(
    (sum, record) => (record.dustbinType !== 'General Waste' ? sum + record.latestWeight : sum),
    0,
  );
  const totalWasteTrend =
    prevTotalWaste > 0
      ? Number((((totalWaste - prevTotalWaste) / prevTotalWaste) * 100).toFixed(2))
      : 0;
  const landfillDiversionTrend =
    prevLandfillDiversion > 0
      ? Number(
          (((landfillDiversion - prevLandfillDiversion) / prevLandfillDiversion) * 100).toFixed(2),
        )
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
 * getActivityFeed:
 * Retrieves activity feed data.
 * (Retained as showing all events; adjust if you require only the latest per day.)
 */
const getActivityFeed = asyncHandler(async (req, res) => {
  const { branchId, companyId } = req.query;
  if (!branchId && !companyId)
    throw new ApiError(400, 'Either branchId or companyId must be provided');
  let branchIds = [];
  if (branchId) {
    if (!mongoose.Types.ObjectId.isValid(branchId))
      throw new ApiError(400, 'Invalid branchId format');
    branchIds = [new mongoose.Types.ObjectId(branchId)];
  } else if (companyId) {
    if (!mongoose.Types.ObjectId.isValid(companyId))
      throw new ApiError(400, 'Invalid companyId format');
    const branches = await BranchAddress.find({
      associatedCompany: new mongoose.Types.ObjectId(companyId),
      isdeleted: false,
    })
      .select('_id')
      .lean();
    branchIds = branches.map((b) => b._id);
    if (branchIds.length === 0) throw new ApiError(404, 'No branches found for the given company');
  }
  const endDate = endOfDay(new Date());
  const startDate = subDays(endDate, 6);
  const pipeline = [
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    {
      $lookup: {
        from: 'dustbins',
        localField: 'associateBin',
        foreignField: '_id',
        as: 'binData',
      },
    },
    { $unwind: '$binData' },
    { $match: { 'binData.branchAddress': { $in: branchIds } } },
    { $sort: { createdAt: 1 } },
  ];
  try {
    const activities = await Waste.aggregate(pipeline, { allowDiskUse: true });
    return res
      .status(200)
      .json(new ApiResponse(200, activities, 'Activity feed data retrieved successfully'));
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch activity feed data');
  }
});
//--------------------------------------------------------------------------------------leader board data outdated code
// /**
//  * getLeaderboardData:
//  * Aggregates cumulative waste per branch for the leaderboard using the latest reading per bin per day.
//  */
const getLeaderboardData = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId } = req.query;
  const now = new Date();
  // Use the same period logic as before.
  const { startDate, endDate, periodLabel } = getDateRangeForLeaderboard(now);

  // Build branch filter based on companyId and optionally orgUnitId.
  let branchFilter = { isdeleted: false };
  if (companyId) {
    branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
  }
  // If an organization unit is selected, assume its ID corresponds to a branch.
  if (orgUnitId) {
    branchFilter._id = new mongoose.Types.ObjectId(orgUnitId);
  }

  // Retrieve branches matching the filter.
  const branches = await BranchAddress.find(branchFilter)
    .select('_id officeName associatedCompany')
    .lean();
  const branchIds = branches.map((b) => b._id);
  if (branchIds.length === 0) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { leaderboard: [], period: periodLabel },
          'No branches found for the given filter',
        ),
      );
  }

  // Build the aggregation pipeline.
  let pipeline = [
    // Filter waste records over the leaderboard period.
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    // Add a 'day' field in UTC (formatted as YYYY-MM-DD).
    {
      $addFields: {
        day: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
        },
      },
    },
    // Sort so that the latest record per bin appears first.
    { $sort: { associateBin: 1, createdAt: -1 } },
    // Group by bin and day, picking the latest reading per bin per day.
    {
      $group: {
        _id: { bin: '$associateBin', day: '$day' },
        latestWaste: { $first: '$currentWeight' },
      },
    },
    // Sum the daily latest readings per bin.
    {
      $group: {
        _id: '$_id.bin',
        cumulativeWaste: { $sum: '$latestWaste' },
      },
    },
    // Look up bin details.
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    // Only include bins from the branches we care about.
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
    // Lookup branch details for grouping.
    {
      $lookup: {
        from: 'branchaddresses',
        localField: 'binDetails.branchAddress',
        foreignField: '_id',
        as: 'branchDetails',
      },
    },
    { $unwind: '$branchDetails' },
  ];

  // If an organization unit is selected, group at the branch level.
  if (orgUnitId) {
    pipeline.push(
      {
        $group: {
          _id: '$branchDetails._id',
          branchName: { $first: '$branchDetails.officeName' },
          totalWaste: { $sum: '$cumulativeWaste' },
          landfillDiversion: {
            $sum: {
              $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0],
            },
          },
        },
      },
      {
        $project: {
          totalWaste: 1,
          diversionPercentage: {
            $cond: [
              { $gt: ['$totalWaste', 0] },
              { $multiply: [{ $divide: ['$landfillDiversion', '$totalWaste'] }, 100] },
              0,
            ],
          },
          name: '$branchName',
        },
      },
    );
  } else {
    // Otherwise, group at the organization level.
    pipeline.push(
      {
        $group: {
          _id: '$branchDetails.associatedCompany',
          totalWaste: { $sum: '$cumulativeWaste' },
          landfillDiversion: {
            $sum: {
              $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0],
            },
          },
        },
      },
      // Join with companies collection to retrieve company names.
      {
        $lookup: {
          from: 'companies',
          localField: '_id',
          foreignField: '_id',
          as: 'companyDetails',
        },
      },
      { $unwind: '$companyDetails' },
      {
        $project: {
          totalWaste: 1,
          diversionPercentage: {
            $cond: [
              { $gt: ['$totalWaste', 0] },
              { $multiply: [{ $divide: ['$landfillDiversion', '$totalWaste'] }, 100] },
              0,
            ],
          },
          name: '$companyDetails.CompanyName',
        },
      },
    );
  }

  // Sort the results in descending order by diversion percentage.
  pipeline.push({ $sort: { diversionPercentage: -1 } });

  const leaderboard = await Waste.aggregate(pipeline).allowDiskUse(true);
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { leaderboard, period: periodLabel },
        'Leaderboard data fetched successfully',
      ),
    );
});

const getDateRangeForLeaderboard = (now = new Date()) => {
  let periodLabel = 'This Month';
  let startDate, endDate;
  if (now.getUTCDate() <= 7) {
    // Use last month's period to ensure sufficient data.
    const lastMonth = subMonths(now, 1);
    startDate = startOfMonth(lastMonth);
    endDate = endOfMonth(lastMonth);
    periodLabel = 'Last Month';
  } else {
    startDate = startOfMonth(now);
    endDate = endOfMonth(now);
  }
  return { startDate, endDate, periodLabel };
};

// --------------------
// Waste Trend Chart
// --------------------
const getWasteTrendChart = asyncHandler(async (req, res) => {
  const { branchId, companyId, orgUnitId, filter, zoomDate } = req.query;

  // Build branchIds using branch, company or org unit filters.
  let branchIds = [];
  if (branchId) {
    if (!mongoose.Types.ObjectId.isValid(branchId))
      throw new ApiError(400, 'Invalid branchId format');
    branchIds = [new mongoose.Types.ObjectId(branchId)];
  } else if (companyId) {
    if (!mongoose.Types.ObjectId.isValid(companyId))
      throw new ApiError(400, 'Invalid companyId format');
    const branches = await BranchAddress.find({
      associatedCompany: new mongoose.Types.ObjectId(companyId),
      isdeleted: false,
    })
      .select('_id')
      .lean();
    if (!branches.length) throw new ApiError(404, 'No branches found for the given company');
    branchIds = branches.map((b) => b._id);
  } else if (orgUnitId) {
    if (!mongoose.Types.ObjectId.isValid(orgUnitId))
      throw new ApiError(400, 'Invalid orgUnitId format');
    // Look up the org unit.
    let orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      // Fall back to branch lookup if org unit not found.
      const branch = await BranchAddress.findById(orgUnitId).lean();
      if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
      orgUnit = {
        _id: branch._id,
        type: 'Branch',
        branchAddress: branch._id,
        name: branch.officeName,
      };
    }
    switch (orgUnit.type) {
      case 'Branch':
        if (orgUnit.branchAddress) branchIds = [new mongoose.Types.ObjectId(orgUnit.branchAddress)];
        else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
        break;
      case 'City': {
        const branchesInCity = await BranchAddress.find({
          city: orgUnit.name,
          isdeleted: false,
        })
          .select('_id')
          .lean();
        branchIds = branchesInCity.map((b) => b._id);
        break;
      }
      case 'Country': {
        const branchesInCountry = await BranchAddress.find({
          country: orgUnit.name,
          isdeleted: false,
        })
          .select('_id')
          .lean();
        branchIds = branchesInCountry.map((b) => b._id);
        break;
      }
      case 'Region':
      case 'State': {
        const branchesInSubdivision = await BranchAddress.find({
          subdivision: orgUnit.name,
          isdeleted: false,
        })
          .select('_id')
          .lean();
        branchIds = branchesInSubdivision.map((b) => b._id);
        break;
      }
      default: {
        const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
        branchIds = allBranches.map((b) => b._id);
      }
    }
  } else {
    const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
    branchIds = allBranches.map((b) => b._id);
  }
  if (!branchIds.length) {
    return res.status(200).json(new ApiResponse(200, [], 'No branches found for the given filter'));
  }

  // Determine date range and aggregation granularity.
  const now = new Date();
  let startDateVal, endDateVal;
  let isHourly = false;
  if (filter === 'today' || zoomDate) {
    if (zoomDate) {
      const zDate = new Date(zoomDate);
      if (isNaN(zDate)) throw new ApiError(400, 'Invalid zoomDate format');
      ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(zDate));
    } else {
      ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(now));
    }
    isHourly = true;
  } else {
    ({ startDate: startDateVal, endDate: endDateVal } = getDateRangeFromFilterUTC(filter, now));
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

// --------------------
// Waste Disposition Rates
// --------------------
const getWasteDispositionRates = asyncHandler(async (req, res) => {
  const { branchId, companyId, orgUnitId, filter } = req.query;

  // Build branchIds using branch, company, or org unit filters.
  let branchIds = [];
  if (branchId) {
    if (!mongoose.Types.ObjectId.isValid(branchId))
      throw new ApiError(400, 'Invalid branchId format');
    branchIds = [new mongoose.Types.ObjectId(branchId)];
  } else if (companyId) {
    if (!mongoose.Types.ObjectId.isValid(companyId))
      throw new ApiError(400, 'Invalid companyId format');
    const branches = await BranchAddress.find({
      associatedCompany: new mongoose.Types.ObjectId(companyId),
      isdeleted: false,
    })
      .select('_id')
      .lean();
    if (!branches.length) throw new ApiError(404, 'No branches found for the given company');
    branchIds = branches.map((b) => b._id);
  } else if (orgUnitId) {
    if (!mongoose.Types.ObjectId.isValid(orgUnitId))
      throw new ApiError(400, 'Invalid orgUnitId format');
    let orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      const branch = await BranchAddress.findById(orgUnitId).lean();
      if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
      orgUnit = {
        _id: branch._id,
        type: 'Branch',
        branchAddress: branch._id,
        name: branch.officeName,
      };
    }
    switch (orgUnit.type) {
      case 'Branch':
        if (orgUnit.branchAddress) branchIds = [new mongoose.Types.ObjectId(orgUnit.branchAddress)];
        else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
        break;
      case 'City': {
        const branchesInCity = await BranchAddress.find({
          city: orgUnit.name,
          isdeleted: false,
        })
          .select('_id')
          .lean();
        branchIds = branchesInCity.map((b) => b._id);
        break;
      }
      case 'Country': {
        const branchesInCountry = await BranchAddress.find({
          country: orgUnit.name,
          isdeleted: false,
        })
          .select('_id')
          .lean();
        branchIds = branchesInCountry.map((b) => b._id);
        break;
      }
      case 'Region':
      case 'State': {
        const branchesInSubdivision = await BranchAddress.find({
          subdivision: orgUnit.name,
          isdeleted: false,
        })
          .select('_id')
          .lean();
        branchIds = branchesInSubdivision.map((b) => b._id);
        break;
      }
      default: {
        const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
        branchIds = allBranches.map((b) => b._id);
      }
    }
  } else {
    const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
    branchIds = allBranches.map((b) => b._id);
  }
  if (!branchIds.length) {
    return res.status(200).json(new ApiResponse(200, [], 'No branches found for the given filter'));
  }

  // Determine date range and aggregation granularity.
  // When filter is "today", aggregate hourly; otherwise, daily.
  const now = new Date();
  let startDateVal, endDateVal;
  let isHourly = false;
  if (filter === 'today') {
    ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(now));
    isHourly = true;
  } else {
    ({ startDate: startDateVal, endDate: endDateVal } = getDateRangeFromFilterUTC(filter, now));
  }

  // Build pipeline.
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

// --------------------
// Export functions
// --------------------
export {
  getAdminOverview,
  getActivityFeed,
  getLeaderboardData,
  getWasteTrendChart,
  getWasteDispositionRates,
};
