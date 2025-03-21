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
 * Helper Function: getDateRangeFromFilter
 * -------------------------------------------
 * Given a filter string (today, thisWeek, thisMonth, lastMonth) and current date,
 * returns an object with startDate and endDate to be used in aggregations.
 */
const getDateRangeFromFilter = (filter, now = new Date()) => {
  let startDate, endDate;
  switch (filter) {
    case 'today':
      startDate = startOfDay(now);
      endDate = endOfDay(now);
      break;
    case 'thisWeek':
      // Assuming week starts on Monday; adjust as needed.
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
      // Default to today if filter is not provided or invalid.
      startDate = startOfDay(now);
      endDate = endOfDay(now);
      break;
  }
  return { startDate, endDate };
};

/***********************************************************************
 * Used in Bin Display Dashboard
 ***********************************************************************/

/**
 * GET /api/v1/analytics/latestBinWeight
 * -------------------------------------------
 * Retrieves the most recent waste event (latest weight reading) for a specific bin for today's date.
 *
 * Query Parameters:
 *   - binId (required): The ObjectId of the bin.
 *
 * Returns:
 *   - Latest waste record (if available) or null with an appropriate message.
 */
export const getLatestBinWeight = asyncHandler(async (req, res) => {
  const { binId } = req.query;
  if (!binId) {
    throw new ApiError(400, 'binId is required');
  }
  if (!mongoose.Types.ObjectId.isValid(binId)) {
    throw new ApiError(400, 'Invalid binId format');
  }
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const latestWasteRecord = await Waste.findOne({
    associateBin: binId,
    createdAt: { $gte: todayStart, $lte: todayEnd },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!latestWasteRecord) {
    return res.status(200).json(new ApiResponse(200, null, 'No waste record found for today'));
  }
  return res
    .status(200)
    .json(new ApiResponse(200, latestWasteRecord, 'Latest waste record fetched successfully'));
});

/**
 * GET /api/v1/analytics/binStatus
 * -------------------------------------------
 * Retrieves real-time bin status data for a given branch.
 * Query Parameters:
 *   - branchId (required): The ObjectId of the branch.
 * Returns an array of dustbin records including:
 *   - _id, dustbinType (as binName), currentWeight, binCapacity,
 *   - isActive flag (true if the bin is not marked as cleaned).
 */
export const getBinStatus = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
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

/***********************************************************************
 * Analytics Endpoints with Date Filtering and Optimized Pipelines
 ***********************************************************************/

/**
 * GET /api/v1/analytics/adminOverview
 * -------------------------------------------
 * Retrieves aggregated analytics for the admin dashboard.
 * Returns:
 *   - totalBins: Total number of bins in scope.
 *   - totalWaste: Sum of the latest waste reading per bin in the period.
 *   - landfillDiversion: Sum of waste from bins not classified as "General Waste".
 *
 * Accepts query parameters:
 *   - companyId (optional)
 *   - filter (optional): "today", "thisWeek", "thisMonth", or "lastMonth"
 *
 * Optimization: Instead of sorting all records then grouping,
 * we first group by bin using $max to get the latest timestamp,
 * then lookup the corresponding record.
 *
 * IMPORTANT: For best performance with huge datasets, ensure proper indexing on:
 *  - { createdAt: 1, associateBin: 1 } in Waste collection.
 *  - { _id: 1, branchAddress: 1 } in Dustbin collection.
 */
export const getAdminOverview = asyncHandler(async (req, res) => {
  const { companyId, filter } = req.query;
  const now = new Date();
  const { startDate, endDate } = getDateRangeFromFilter(filter, now);

  // Build branch filter for BranchAddress query if companyId is provided.
  let branchFilter = {};
  if (companyId) {
    branchFilter.associatedCompany = mongoose.Types.ObjectId(companyId);
    branchFilter.isdeleted = false;
  }
  const branches = await BranchAddress.find(branchFilter).select('_id').lean();
  const branchIds = branches.map((branch) => branch._id);
  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

  // Optimized pipeline:
  // 1. Match waste records in the date range.
  // 2. Group by dustbin with maximum createdAt.
  // 3. Lookup corresponding waste record.
  // 4. Join with Dustbin to get bin type.
  const wasteAgg = await Waste.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$associateBin',
        latestDate: { $max: '$createdAt' },
      },
    },
    {
      $lookup: {
        from: 'wastes',
        let: { binId: '$_id', latestDate: '$latestDate' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$associateBin', '$$binId'] },
                  { $eq: ['$createdAt', '$$latestDate'] },
                ],
              },
            },
          },
          { $project: { currentWeight: 1, createdAt: 1 } },
        ],
        as: 'latestRecord',
      },
    },
    { $unwind: '$latestRecord' },
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    {
      $match: {
        'binDetails.branchAddress': { $in: branchIds },
      },
    },
  ]);

  // Sum weights across bins and calculate landfill diversion.
  let totalWaste = 0;
  let landfillDiversion = 0;
  wasteAgg.forEach((record) => {
    const weight = record.latestRecord.currentWeight;
    totalWaste += weight;
    if (record.binDetails.dustbinType !== 'General Waste') {
      landfillDiversion += weight;
    }
  });

  const overviewData = {
    totalBins,
    totalWaste,
    landfillDiversion,
  };

  return res
    .status(200)
    .json(new ApiResponse(200, overviewData, 'Admin overview data fetched successfully'));
});

/**
 * GET /api/v1/analytics/minimalOverview
 * -------------------------------------------
 * Retrieves minimal overview data (for employee or bin display dashboards).
 * Returns:
 *   - todayWaste: Sum of latest waste readings in the period for the branch.
 *   - trendData: Aggregated waste data by day.
 *   - branchContribution: Percentage contribution of the branch relative to company.
 *
 * Accepts query parameters:
 *   - branchId (required)
 *   - filter (optional): "today", "thisWeek", "thisMonth", or "lastMonth"
 */
export const getMinimalOverview = asyncHandler(async (req, res) => {
  const { branchId, filter } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  const now = new Date();
  const { startDate, endDate } = getDateRangeFromFilter(filter, now);

  // Trend pipeline: Aggregate waste per day (using latest record per bin each day).
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
    {
      $match: {
        'binData.branchAddress': new mongoose.Types.ObjectId(branchId),
      },
    },
    {
      $group: {
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
        totalWeight: { $sum: '$currentWeight' },
      },
    },
    { $sort: { '_id.date': 1 } },
  ];
  const trendData = await Waste.aggregate(trendPipeline);

  // Aggregate latest reading per bin for the branch in the period.
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
    {
      $match: {
        'binData.branchAddress': new mongoose.Types.ObjectId(branchId),
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$associateBin',
        latestWeight: { $first: '$currentWeight' },
      },
    },
    {
      $group: {
        _id: null,
        totalBranchWaste: { $sum: '$latestWeight' },
      },
    },
  ]);
  const todayWaste = branchWasteAgg[0]?.totalBranchWaste || 0;

  // For branchContribution, compare branch waste with company's total for the period.
  const branchRecord = await BranchAddress.findById(branchId).lean();
  if (!branchRecord) {
    throw new ApiError(404, 'Branch not found');
  }
  const compId = branchRecord.associatedCompany;
  const companyBranches = await BranchAddress.find({ associatedCompany: compId })
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
    {
      $group: {
        _id: null,
        totalCompanyWaste: { $sum: '$currentWeight' },
      },
    },
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
 * -------------------------------------------
 * Retrieves time-series data for the waste trend chart.
 * For each bin in the branch, only the last recorded weight for each day is used.
 *
 * Accepts query parameters:
 *   - branchId (required)
 *   - filter (optional): Determines the date range.
 */
export const getWasteTrendChart = asyncHandler(async (req, res) => {
  const { branchId, filter, days } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    throw new ApiError(400, 'Invalid branchId format');
  }
  if (branchId === 'defaultBranchId') {
    throw new ApiError(400, 'A valid branchId must be provided');
  }
  const { startDate, endDate } = getDateRangeFromFilter(filter, new Date());

  // Aggregation pipeline:
  // 1. Match waste records within the date range.
  // 2. Lookup dustbin details.
  // 3. Filter by branch.
  // 4. Group records by bin and day (using last reading).
  // 5. Group by bin to create an array of daily data.
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
    {
      $match: {
        'binData.branchAddress': new mongoose.Types.ObjectId(branchId),
      },
    },
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
 * -------------------------------------------
 * Compares waste generation between two consecutive periods.
 * For each bin/day, only the last reading is considered.
 *
 * Accepts query parameters:
 *   - branchId (required)
 *   - filter (optional): Determines the current period. The previous period is calculated accordingly.
 */
export const getWasteTrendComparison = asyncHandler(async (req, res) => {
  const { branchId, filter } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  const now = new Date();
  // Current period based on filter.
  const { startDate: currentStart, endDate: currentEnd } = getDateRangeFromFilter(filter, now);

  // Previous period calculation:
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
      // Compare with two months ago
      previousStart = startOfMonth(subMonths(now, 2));
      previousEnd = endOfMonth(subMonths(now, 2));
      break;
    default:
      previousStart = startOfDay(subDays(now, 1));
      previousEnd = endOfDay(subDays(now, 1));
      break;
  }

  // Helper aggregation to sum total waste for a period.
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

  // Calculate percentage change.
  let percentageChange = 0;
  let trend = 'no change';
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
 * -------------------------------------------
 * Retrieves waste data for the last 7 days.
 * For each bin and day, only the last reading is used.
 *
 * Accepts query parameters:
 *   - branchId (required)
 */
export const getWasteLast7Days = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  const today = new Date();
  const startDate = startOfDay(subDays(today, 6)); // 6 days ago + today = 7 days.
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
    {
      $match: {
        'binData.branchAddress': new mongoose.Types.ObjectId(branchId),
      },
    },
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
 * -------------------------------------------
 * Provides a chronological list of activity events (for demonstration,
 * currently returning waste data for the past 7 days).
 *
 * Accepts query parameters:
 *   - branchId (required)
 */
export const getActivityFeed = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  // For demo purposes, use a fixed 7-day period.
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
    { $match: { 'binData.branchAddress': mongoose.Types.ObjectId(branchId) } },
    { $sort: { createdAt: 1 } },
  ];

  const activities = await Waste.aggregate(pipeline);
  return res
    .status(200)
    .json(new ApiResponse(200, activities, 'Activity feed data retrieved successfully'));
});

/**
 * GET /api/v1/analytics/adminLeaderboard
 * -------------------------------------------
 * Retrieves leaderboard data.
 * For SuperAdmin, it ranks companies; for other admins, it ranks offices.
 * For demonstration, the ranking is based on total waste using the latest reading per bin.
 *
 * Accepts query parameters:
 *   - branchId or companyId (one of them must be provided)
 */
export const getAdminLeaderboard = asyncHandler(async (req, res) => {
  const { branchId, companyId } = req.query;

  // If branchId is provided, assume office-level leaderboard.
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
      { $match: { 'binData.branchAddress': mongoose.Types.ObjectId(branchId) } },
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
      if (!mongoose.Types.ObjectId.isValid(companyId)) {
        throw new ApiError(400, 'Invalid companyId format');
      }
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
