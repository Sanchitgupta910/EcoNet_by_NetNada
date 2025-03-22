import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { OrgUnit } from '../models/orgUnit.model.js ';
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
 * Helper function to compute date range based on a filter.
 * @param {string} filter - one of "today", "thisWeek", "thisMonth", "lastMonth"
 * @param {Date} now - current date
 * @returns {Object} - { startDate, endDate }
 */
const getDateRangeFromFilter = (filter, now = new Date()) => {
  let startDate, endDate;
  switch (filter) {
    case 'today':
      startDate = startOfDay(now);
      endDate = endOfDay(now);
      break;
    case 'thisWeek':
      startDate = startOfWeek(now, { weekStartsOn: 1 });
      endDate = endOfWeek(now, { weekStartsOn: 1 });
      break;
    case 'thisMonth':
      startDate = startOfMonth(now);
      endDate = endOfMonth(now);
      break;
    case 'lastMonth': {
      const lastMonthDate = subMonths(now, 1);
      startDate = startOfMonth(lastMonthDate);
      endDate = endOfMonth(lastMonthDate);
      break;
    }
    default:
      startDate = startOfDay(now);
      endDate = endOfDay(now);
      break;
  }
  return { startDate: new Date(startDate), endDate: new Date(endDate) };
};

/**
 * Helper function to compute the previous period's date range based on the current filter.
 * Rules:
 *   - If filter is "today": use yesterday.
 *   - If filter is "thisWeek": use last week.
 *   - If filter is "thisMonth": use last month.
 *   - If filter is "lastMonth": compare to this month.
 */
const getPreviousDateRange = (filter, now = new Date()) => {
  let previousStartDate, previousEndDate;
  switch (filter) {
    case 'today':
      // Yesterday's range
      previousStartDate = startOfDay(subDays(now, 1));
      previousEndDate = endOfDay(subDays(now, 1));
      break;
    case 'thisWeek':
      // Last week's range
      previousStartDate = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      previousEndDate = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      break;
    case 'thisMonth':
      // Last month's range
      {
        const lastMonthDate = subMonths(now, 1);
        previousStartDate = startOfMonth(lastMonthDate);
        previousEndDate = endOfMonth(lastMonthDate);
      }
      break;
    case 'lastMonth':
      // For "lastMonth" filter, compare to this month's data.
      previousStartDate = startOfMonth(now);
      previousEndDate = endOfMonth(now);
      break;
    default:
      previousStartDate = startOfDay(subDays(now, 1));
      previousEndDate = endOfDay(subDays(now, 1));
      break;
  }
  return {
    previousStartDate: new Date(previousStartDate),
    previousEndDate: new Date(previousEndDate),
  };
};

/**
 * Aggregation pipeline function to compute cumulative waste for a given date range.
 * For each bin, on each day in the range, only the latest (most recent) reading is used.
 * Returns an object with two properties:
 *   - totalWaste: Sum of daily last readings for all bins.
 *   - landfillDiversion: Sum of daily last readings for bins not labeled "General Waste".
 *
 * @param {Date} rangeStart - Start date of the range.
 * @param {Date} rangeEnd - End date of the range.
 * @param {Array} branchIds - Array of BranchAddress _id values to filter bins.
 */
const aggregateWasteData = async (rangeStart, rangeEnd, branchIds) => {
  const wasteAgg = await Waste.aggregate([
    // Match waste records within the date range.
    {
      $match: {
        createdAt: { $gte: rangeStart, $lte: rangeEnd },
      },
    },
    // Create a 'day' field in YYYY-MM-DD format.
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      },
    },
    // Sort by bin and by createdAt descending.
    { $sort: { associateBin: 1, createdAt: -1 } },
    // Group by bin and day: pick the first record (the latest) for each bin/day.
    {
      $group: {
        _id: { associateBin: '$associateBin', day: '$day' },
        latestWaste: { $first: '$currentWeight' },
      },
    },
    // Group by bin: sum the daily latest readings.
    {
      $group: {
        _id: '$_id.associateBin',
        cumulativeWaste: { $sum: '$latestWaste' },
      },
    },
    // Lookup dustbin details.
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    // Only include bins that belong to the filtered branches.
    {
      $match: {
        'binDetails.branchAddress': { $in: branchIds },
      },
    },
  ]);

  // Calculate aggregated values.
  let totalWaste = 0,
    landfillDiversion = 0;
  wasteAgg.forEach((record) => {
    totalWaste += record.cumulativeWaste;
    if (record.binDetails.dustbinType !== 'General Waste') {
      landfillDiversion += record.cumulativeWaste;
    }
  });
  return { totalWaste, landfillDiversion };
};

/********************* Basic Endpoints ***************************/

/**
 * GET /api/v1/analytics/latestBinWeight
 * Retrieves the latest waste record for a specific bin for today.
 */
export const getLatestBinWeight = asyncHandler(async (req, res) => {
  const { binId } = req.query;
  if (!binId) throw new ApiError(400, 'binId is required');
  if (!mongoose.Types.ObjectId.isValid(binId)) throw new ApiError(400, 'Invalid binId format');

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const latestWasteRecord = await Waste.findOne({
    associateBin: binId,
    createdAt: { $gte: todayStart, $lte: todayEnd },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!latestWasteRecord)
    return res.status(200).json(new ApiResponse(200, null, 'No waste record found for today'));

  return res
    .status(200)
    .json(new ApiResponse(200, latestWasteRecord, 'Latest waste record fetched successfully'));
});

/**
 * GET /api/v1/analytics/binStatus
 * Retrieves real-time bin status for a given branch.
 */
export const getBinStatus = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  try {
    const bins = await Dustbin.find({ branchAddress: branchId }).lean();
    const binStatus = bins.map((bin) => ({
      _id: bin._id,
      binName: bin.dustbinType,
      currentWeight: bin.currentWeight,
      binCapacity: bin.binCapacity,
      isActive: !bin.isCleaned,
    }));
    return res
      .status(200)
      .json(new ApiResponse(200, binStatus, 'Bin status data fetched successfully'));
  } catch (error) {
    console.error('Error in getBinStatus:', error);
    throw new ApiError(500, 'Failed to fetch bin status data');
  }
});

/********************* Analytics Endpoints ***************************/

/**
 * GET /api/v1/analytics/adminOverview
 *
 * Aggregates and returns dashboard data for the admin view. Metrics include:
 *  - totalBins: Total number of bins in the filtered branches.
 *  - totalWaste: Cumulative waste collected over the current date range.
 *  - landfillDiversionPercentage: (landfillDiversion / totalWaste) * 100.
 *  - totalWasteTrend: Percentage difference in totalWaste between current and previous period.
 *  - landfillDiversionTrend: Percentage difference in landfill diversion between current and previous period.
 *
 * Query Parameters:
 *  - companyId: (Optional) Filter branches by company.
 *  - orgUnitId: (Optional) Further filter branches by an OrgUnit.
 *  - filter: Date filter ("today", "thisWeek", "thisMonth", "lastMonth").
 */
export const getAdminOverview = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId, filter } = req.query;
  const now = new Date();

  // Compute current period date range.
  const { startDate, endDate } = getDateRangeFromFilter(filter, now);
  // Compute previous period date range.
  const { previousStartDate, previousEndDate } = getPreviousDateRange(filter, now);

  // Build branch filter.
  let branchFilter = { isdeleted: false };
  if (companyId) {
    branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
  }
  if (orgUnitId) {
    const orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      throw new ApiError(404, 'OrgUnit not found');
    }
    switch (orgUnit.type) {
      case 'Branch':
        if (orgUnit.branchAddress) {
          branchFilter._id = new mongoose.Types.ObjectId(orgUnit.branchAddress);
        } else {
          throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
        }
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

  // Retrieve filtered branches.
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

  // Count total bins in the filtered branches.
  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

  // Aggregate current period waste data.
  const { totalWaste, landfillDiversion } = await aggregateWasteData(startDate, endDate, branchIds);
  // Calculate current diversion percentage.
  const currentDiversionPercentage =
    totalWaste > 0 ? Number(((landfillDiversion / totalWaste) * 100).toFixed(2)) : 0;

  // Aggregate previous period waste data.
  const { totalWaste: prevTotalWaste, landfillDiversion: prevLandfillDiversion } =
    await aggregateWasteData(previousStartDate, previousEndDate, branchIds);

  // Calculate trends (percentage difference relative to previous period).
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
 * GET /api/v1/analytics/minimalOverview
 * Returns minimal overview data for a branch:
 * - todayWaste, trendData (daily aggregated waste), branchContribution.
 */
export const getMinimalOverview = asyncHandler(async (req, res) => {
  const { branchId, filter } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  const now = new Date();
  const { startDate, endDate } = getDateRangeFromFilter(filter, now);

  // Aggregate daily trend data.
  const trendPipeline = [
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
    { $match: { 'binData.branchAddress': new mongoose.Types.ObjectId(branchId) } },
    {
      $group: {
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
        totalWeight: { $sum: '$currentWeight' },
      },
    },
    { $sort: { '_id.date': 1 } },
  ];
  const trendData = await Waste.aggregate(trendPipeline);

  // Latest reading per bin.
  const branchWasteAgg = await Waste.aggregate([
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
    { $match: { 'binData.branchAddress': new mongoose.Types.ObjectId(branchId) } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$associateBin', latestWeight: { $first: '$currentWeight' } } },
    { $group: { _id: null, totalBranchWaste: { $sum: '$latestWeight' } } },
  ]);
  const todayWaste = branchWasteAgg[0]?.totalBranchWaste || 0;

  // Calculate branch contribution relative to company.
  const branchRecord = await BranchAddress.findById(branchId).lean();
  if (!branchRecord) throw new ApiError(404, 'Branch not found');
  const compId = branchRecord.associatedCompany;
  const companyBranches = await BranchAddress.find({
    associatedCompany: new mongoose.Types.ObjectId(compId),
  })
    .select('_id')
    .lean();
  const branchIds = companyBranches.map((b) => b._id);
  const companyWasteAgg = await Waste.aggregate([
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
    { $group: { _id: null, totalCompanyWaste: { $sum: '$currentWeight' } } },
  ]);
  const totalCompanyWaste = companyWasteAgg[0]?.totalCompanyWaste || 0;
  const branchContribution = totalCompanyWaste
    ? Math.round((todayWaste / totalCompanyWaste) * 100)
    : 0;

  const overview = { todayWaste, trendData, branchContribution };
  return res
    .status(200)
    .json(new ApiResponse(200, overview, 'Minimal overview data fetched successfully'));
});

/**
 * GET /api/v1/analytics/wasteTrendChart
 * Returns time-series waste data for the trend chart.
 * Accepts query parameters: branchId (optional), companyId (optional), filter (optional), days (optional).
 * If branchId is provided, filters at branch level; else aggregates for the company.
 */
export const getWasteTrendChart = asyncHandler(async (req, res) => {
  const { branchId, companyId, filter, days } = req.query;
  if (!branchId && !companyId)
    throw new ApiError(400, 'Either branchId or companyId must be provided');
  const { startDate, endDate } = getDateRangeFromFilter(filter, new Date());
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
    {
      $group: {
        _id: {
          bin: '$associateBin',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        },
        weight: { $last: '$currentWeight' },
        binName: { $first: '$binData.dustbinType' },
      },
    },
    {
      $group: {
        _id: '$_id.bin',
        binName: { $first: '$binName' },
        data: { $push: { date: '$_id.date', weight: '$weight' } },
      },
    },
    { $sort: { binName: 1 } },
  ];
  try {
    const trendData = await Waste.aggregate(pipeline);
    return res
      .status(200)
      .json(new ApiResponse(200, trendData, 'Waste trend chart data retrieved successfully'));
  } catch (error) {
    console.error('Error in getWasteTrendChart:', error);
    throw new ApiError(500, 'Failed to fetch waste trend chart data');
  }
});

/**
 * GET /api/v1/analytics/wasteTrendComparison
 * Compares waste generation between two consecutive periods.
 * Accepts query parameters: branchId (required), filter (optional).
 */
export const getWasteTrendComparison = asyncHandler(async (req, res) => {
  const { branchId, filter } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  const now = new Date();
  const { startDate: currentStart, endDate: currentEnd } = getDateRangeFromFilter(filter, now);
  let previousStart, previousEnd;
  switch (filter) {
    case 'today':
      previousStart = startOfDay(subDays(now, 1));
      previousEnd = endOfDay(subDays(now, 1));
      break;
    case 'thisWeek':
      previousStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      previousEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      break;
    case 'thisMonth':
      previousStart = startOfMonth(subMonths(now, 1));
      previousEnd = endOfMonth(subMonths(now, 1));
      break;
    case 'lastMonth':
      previousStart = startOfMonth(subMonths(now, 2));
      previousEnd = endOfMonth(subMonths(now, 2));
      break;
    default:
      previousStart = startOfDay(subDays(now, 1));
      previousEnd = endOfDay(subDays(now, 1));
      break;
  }
  const aggregateWasteForPeriod = async (startDate, endDate) => {
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
      { $match: { 'binData.branchAddress': new mongoose.Types.ObjectId(branchId) } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            bin: '$associateBin',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          },
          latestWeight: { $first: '$currentWeight' },
        },
      },
      {
        $group: {
          _id: null,
          totalWaste: { $sum: '$latestWeight' },
        },
      },
    ];
    const result = await Waste.aggregate(pipeline);
    return result[0]?.totalWaste || 0;
  };
  const thisPeriodWaste = await aggregateWasteForPeriod(currentStart, currentEnd);
  const previousPeriodWaste = await aggregateWasteForPeriod(previousStart, previousEnd);
  let percentageChange = 0,
    trend = 'no change';
  if (previousPeriodWaste > 0) {
    percentageChange = ((thisPeriodWaste - previousPeriodWaste) / previousPeriodWaste) * 100;
    trend =
      thisPeriodWaste > previousPeriodWaste
        ? 'higher'
        : thisPeriodWaste < previousPeriodWaste
        ? 'lower'
        : 'equal';
  } else {
    percentageChange = thisPeriodWaste > 0 ? 100 : 0;
    trend = thisPeriodWaste > 0 ? 'higher' : 'no change';
  }
  const data = {
    thisPeriodWaste,
    previousPeriodWaste,
    percentageChange: Math.round(percentageChange * 100) / 100,
    trend,
  };
  return res
    .status(200)
    .json(new ApiResponse(200, data, 'Waste trend comparison data retrieved successfully'));
});

/**
 * GET /api/v1/analytics/wasteLast7Days
 * Retrieves waste data for the last 7 days using the last reading per bin per day.
 * Accepts query parameter: branchId (required).
 */
export const getWasteLast7Days = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  const today = new Date();
  const startDate = startOfDay(subDays(today, 6));
  const endDate = endOfDay(today);
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
    { $match: { 'binData.branchAddress': new mongoose.Types.ObjectId(branchId) } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: {
          bin: '$associateBin',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        },
        weight: { $last: '$currentWeight' },
        binName: { $first: '$binData.dustbinType' },
      },
    },
    {
      $group: {
        _id: '$_id.bin',
        binName: { $first: '$binName' },
        data: { $push: { date: '$_id.date', weight: '$weight' } },
      },
    },
    { $sort: { binName: 1 } },
  ];
  const wasteData = await Waste.aggregate(pipeline);
  return res
    .status(200)
    .json(new ApiResponse(200, wasteData, 'Waste data for last 7 days retrieved successfully'));
});

/**
 * GET /api/v1/analytics/activityFeed
 * Retrieves activity feed data.
 * Accepts query parameters: branchId (optional) or companyId (optional).
 */
export const getActivityFeed = asyncHandler(async (req, res) => {
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
    const activities = await Waste.aggregate(pipeline);
    return res
      .status(200)
      .json(new ApiResponse(200, activities, 'Activity feed data retrieved successfully'));
  } catch (error) {
    console.error('Error in getActivityFeed:', error);
    throw new ApiError(500, 'Failed to fetch activity feed data');
  }
});

/**
 * GET /api/v1/analytics/adminLeaderboard
 * Retrieves leaderboard data.
 * Accepts query parameters: branchId (optional) or companyId (optional).
 */
export const getAdminLeaderboard = asyncHandler(async (req, res) => {
  const { branchId, companyId } = req.query;
  if (branchId) {
    const leaderboardPipeline = [
      { $match: { createdAt: { $gte: startOfDay(new Date()), $lte: endOfDay(new Date()) } } },
      {
        $lookup: {
          from: 'dustbins',
          localField: 'associateBin',
          foreignField: '_id',
          as: 'binData',
        },
      },
      { $unwind: '$binData' },
      { $match: { 'binData.branchAddress': new mongoose.Types.ObjectId(branchId) } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$binData.branchAddress',
          latestWaste: { $first: '$currentWeight' },
        },
      },
      {
        $group: {
          _id: null,
          totalWaste: { $sum: '$latestWaste' },
        },
      },
    ];
    const leaderboardData = await Waste.aggregate(leaderboardPipeline);
    return res
      .status(200)
      .json(
        new ApiResponse(200, leaderboardData, 'Office leaderboard data retrieved successfully'),
      );
  } else if (companyId) {
    let filter = {};
    if (companyId !== 'all') {
      if (!mongoose.Types.ObjectId.isValid(companyId))
        throw new ApiError(400, 'Invalid companyId format');
      filter.associatedCompany = new mongoose.Types.ObjectId(companyId);
    }
    const branches = await BranchAddress.find(filter).select('_id').lean();
    const branchIds = branches.map((b) => b._id);
    const companyLeaderboardPipeline = [
      { $match: { createdAt: { $gte: startOfDay(new Date()), $lte: endOfDay(new Date()) } } },
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
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$binData.branchAddress',
          latestWaste: { $first: '$currentWeight' },
        },
      },
      {
        $group: {
          _id: null,
          totalWaste: { $sum: '$latestWaste' },
        },
      },
    ];
    const leaderboardData = await Waste.aggregate(companyLeaderboardPipeline);
    return res
      .status(200)
      .json(
        new ApiResponse(200, leaderboardData, 'Company leaderboard data retrieved successfully'),
      );
  } else {
    throw new ApiError(400, 'Either branchId or companyId must be provided');
  }
});
