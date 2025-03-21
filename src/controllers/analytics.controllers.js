import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import mongoose from 'mongoose';
import {
  startOfDay,
  endOfDay,
  format,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
} from 'date-fns';

/***********************************************************************Used in Bin Display Dashboard*********************************************************************************/

/**
 * GET /api/v1/analytics/latestBinWeight
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

  // Validate that binId is provided and is a valid ObjectId.
  if (!binId) {
    throw new ApiError(400, 'binId is required');
  }
  if (!mongoose.Types.ObjectId.isValid(binId)) {
    throw new ApiError(400, 'Invalid binId format');
  }

  // Define the time window for today.
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  // Query the Waste collection for the latest record for this bin today.
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
    // Find all dustbins associated with the given branch.
    const bins = await Dustbin.find({ branchAddress: branchId }).lean();
    // Map bins to include isActive flag.
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

/**
 * GET /api/v1/analytics/minimalOverview
 * Retrieves minimal overview data for an employee or bin display user.
 * Query Parameters:
 *   - branchId (required): The ObjectId of the branch.
 * Returns an object with:
 *   - todayWaste: Sum of today's waste for this branch.
 *   - trendData: Hourly aggregated waste data for today.
 *   - branchContribution: The branch's contribution percentage relative to the company.
 */
export const getMinimalOverview = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    // Trend pipeline remains the same (it aggregates by hour)
    const trendPipeline = [
      { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
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
          _id: { hour: { $dateToString: { format: '%H:00', date: '$createdAt' } } },
          totalWeight: { $sum: '$currentWeight' },
        },
      },
      { $sort: { '_id.hour': 1 } },
    ];
    const trendData = await Waste.aggregate(trendPipeline);

    // Updated aggregation: For each bin, get only the latest reading for today.
    const branchWasteAgg = await Waste.aggregate([
      // Only consider records for today.
      { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
      // Join with dustbins to filter by branch.
      {
        $lookup: {
          from: 'dustbins',
          localField: 'associateBin',
          foreignField: '_id',
          as: 'binData',
        },
      },
      { $unwind: '$binData' },
      // Filter to include only bins belonging to this branch.
      {
        $match: {
          'binData.branchAddress': new mongoose.Types.ObjectId(branchId),
        },
      },
      // Sort all records by createdAt descending.
      { $sort: { createdAt: -1 } },
      // Group by bin, selecting the first (latest) reading per bin.
      {
        $group: {
          _id: '$associateBin',
          latestWeight: { $first: '$currentWeight' },
        },
      },
      // Sum up the latest weights from each bin.
      {
        $group: {
          _id: null,
          totalBranchWaste: { $sum: '$latestWeight' },
        },
      },
    ]);
    const todayWaste = branchWasteAgg[0]?.totalBranchWaste || 0;

    // For branchContribution we compare today's branch waste to the company's total waste for today.
    const branch = await BranchAddress.findById(branchId).lean();
    if (!branch) {
      throw new ApiError(404, 'Branch not found');
    }
    const companyId = branch.associatedCompany;
    const companyBranches = await BranchAddress.find({ associatedCompany: companyId })
      .select('_id')
      .lean();
    const branchIds = companyBranches.map((b) => b._id);
    // Filter company waste to only include today's records.
    const companyWasteAgg = await Waste.aggregate([
      { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
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
  } catch (error) {
    console.error('Error in getMinimalOverview:', error);
    throw new ApiError(500, 'Failed to fetch minimal overview data');
  }
});

export const getWasteLast7Days = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }

  // Calculate date range for the last 7 days (including today)
  const today = new Date();
  const startDate = startOfDay(subDays(today, 6)); // 6 days ago plus today = 7 days
  const endDate = endOfDay(today);

  // Aggregation pipeline:
  const pipeline = [
    // Only consider waste records in the date range
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    // Lookup corresponding dustbin data to get dustbinType and branchAddress
    {
      $lookup: {
        from: 'dustbins',
        localField: 'associateBin',
        foreignField: '_id',
        as: 'binData',
      },
    },
    { $unwind: '$binData' },
    // Filter only bins belonging to the given branchId
    {
      $match: {
        'binData.branchAddress': new mongoose.Types.ObjectId(branchId),
      },
    },
    // Sort by createdAt in ascending order
    { $sort: { createdAt: 1 } },
    // Group by bin and by day: for each bin and each day, pick the last reading.
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
    // Group again by bin so that each bin has an array of daily readings.
    {
      $group: {
        _id: '$_id.bin',
        binName: { $first: '$binName' },
        data: { $push: { date: '$_id.date', weight: '$weight' } },
      },
    },
    // Sort the output by binName (optional)
    { $sort: { binName: 1 } },
  ];

  const wasteData = await Waste.aggregate(pipeline);

  return res
    .status(200)
    .json(new ApiResponse(200, wasteData, 'Waste data for last 7 days retrieved successfully'));
});

/**
 * GET /api/v1/analytics/wasteTrendComparison
 * Retrieves a comparison of waste generation between two consecutive 7-day periods:
 *   - This week: total waste generated in the last 7 days (including today)
 *   - Last week: total waste generated in the 7 days prior to that
 *
 * For each bin and for each day in the period, only the last record is considered.
 * Returns an object with:
 *   - thisWeekWaste: total waste (in KG) for the current 7-day period
 *   - lastWeekWaste: total waste (in KG) for the previous 7-day period
 *   - percentageChange: percentage change ((thisWeek - lastWeek) / lastWeek * 100)
 *   - trend: a string indicating whether this week is "higher" or "lower" (or "no change")
 */
export const getWasteTrendComparison = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  try {
    const today = new Date();
    // Define the period for this week (last 7 days including today)
    const thisWeekStart = startOfDay(subDays(today, 6));
    const thisWeekEnd = endOfDay(today);
    // Define the period for last week (the 7 days preceding this week)
    const lastWeekStart = startOfDay(subDays(today, 13));
    const lastWeekEnd = endOfDay(subDays(today, 7));

    // Helper function to aggregate total waste for a given period.
    // For each bin and each day, only the latest record is used.
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
        // Sort descending so the latest record for each bin/day comes first
        { $sort: { createdAt: -1 } },
        // Group by bin and day, taking the first record from the sorted results.
        {
          $group: {
            _id: {
              bin: '$associateBin',
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            },
            latestWeight: { $first: '$currentWeight' },
          },
        },
        // Sum the latestWeight from all groups to get the total waste for the period.
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

    const thisWeekWaste = await aggregateWasteForPeriod(thisWeekStart, thisWeekEnd);
    const lastWeekWaste = await aggregateWasteForPeriod(lastWeekStart, lastWeekEnd);

    // Calculate percentage change and determine the trend.
    let percentageChange = 0;
    let trend = 'no change';
    if (lastWeekWaste > 0) {
      percentageChange = ((thisWeekWaste - lastWeekWaste) / lastWeekWaste) * 100;
      trend =
        thisWeekWaste > lastWeekWaste
          ? 'higher'
          : thisWeekWaste < lastWeekWaste
          ? 'lower'
          : 'equal';
    } else {
      // If last week's waste is zero, then if this week's waste is greater than 0, consider it an increase.
      percentageChange = thisWeekWaste > 0 ? 100 : 0;
      trend = thisWeekWaste > 0 ? 'higher' : 'no change';
    }

    const data = {
      thisWeekWaste,
      lastWeekWaste,
      percentageChange: Math.round(percentageChange * 100) / 100, // Rounded to 2 decimals
      trend,
    };

    return res
      .status(200)
      .json(new ApiResponse(200, data, 'Waste trend comparison data retrieved successfully'));
  } catch (error) {
    console.error('Error in getWasteTrendComparison:', error);
    throw new ApiError(500, 'Failed to fetch waste trend comparison data');
  }
});

/***********************************************************************Used in Admin' Dashboard*********************************************************************************/

/**
 * GET /api/v1/analytics/adminOverview
 *
 * This endpoint retrieves aggregated analytics for the admin dashboard cards.
 * It returns:
 *  - totalBins: Total number of bins in the selected scope.
 *  - totalWaste: Sum of daily waste collected (using only the last recorded weight per bin for the day).
 *  - landfillDiversion: Total weight diverted from landfill (assumes bins not of type "General Waste" are diverted).
 *
 * It supports optional filtering by companyId (and further by OrgUnit if needed).
 */
export const getAdminOverview = asyncHandler(async (req, res) => {
  // Optional filters (e.g., companyId can be passed via query)
  const { companyId } = req.query;
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  // Build filter for BranchAddress if filtering by company
  let branchFilter = {};
  if (companyId) {
    branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
    branchFilter.isdeleted = false;
  }

  // Count total bins: Find all dustbins in branches matching the filter.
  const branches = await BranchAddress.find(branchFilter).select('_id').lean();
  const branchIds = branches.map((branch) => branch._id);
  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

  // Aggregate daily waste data:
  // For each dustbin, we get the last recorded weight of today (assumed as the total waste for that bin).
  const wasteAgg = await Waste.aggregate([
    { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
    {
      $lookup: {
        from: 'dustbins',
        localField: 'associateBin',
        foreignField: '_id',
        as: 'binData',
      },
    },
    { $unwind: '$binData' },
    // Filter to only include waste records for bins in our branches
    { $match: { 'binData.branchAddress': { $in: branchIds } } },
    { $sort: { createdAt: -1 } },
    // Group by bin to take the latest reading
    {
      $group: {
        _id: '$associateBin',
        latestWeight: { $first: '$currentWeight' },
        binType: { $first: '$binData.dustbinType' },
      },
    },
  ]);

  // Calculate total waste and landfill diversion
  let totalWaste = 0;
  let landfillDiversion = 0;
  wasteAgg.forEach((record) => {
    totalWaste += record.latestWeight;
    // Assuming "General Waste" bins are landfill bins. All others are diverted.
    if (record.binType !== 'General Waste') {
      landfillDiversion += record.latestWeight;
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
 * GET /api/v1/analytics/wasteTrendChart
 *
 * This endpoint retrieves time-series data for the waste line chart.
 * It returns daily data for each bin in the selected branch (or across companies),
 * where for each day, only the last recorded weight for that bin is used.
 *
 * Expected query parameters:
 *   - branchId (required)
 *   - days (optional): number of past days to include (default 7)
 */
export const getWasteTrendChart = asyncHandler(async (req, res) => {
  const { branchId, days } = req.query;

  // Validate branchId presence and format
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    throw new ApiError(400, 'Invalid branchId format');
  }
  if (branchId === 'defaultBranchId') {
    throw new ApiError(400, 'A valid branchId must be provided');
  }

  // Determine number of days (default 7)
  const numDays = days ? parseInt(days) : 7;
  const endDate = endOfDay(new Date());
  const startDate = subDays(endDate, numDays - 1);

  // Construct the aggregation pipeline:
  const pipeline = [
    // 1. Filter records in the specified date range
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },

    // 2. Lookup dustbin details using associateBin field
    {
      $lookup: {
        from: 'dustbins',
        localField: 'associateBin',
        foreignField: '_id',
        as: 'binData',
      },
    },

    // 3. Unwind the binData array so each waste record is paired with its dustbin details
    { $unwind: '$binData' },

    // 4. Match only those records where the dustbin's branchAddress matches the provided branchId
    { $match: { 'binData.branchAddress': mongoose.Types.ObjectId(branchId) } },

    // 5. Sort records by createdAt in ascending order
    { $sort: { createdAt: 1 } },

    // 6. Group by bin and by date:
    //    - Use $dateToString to format createdAt as 'YYYY-MM-DD'
    //    - Use $last to take the last (latest) currentWeight of the day for each bin
    //    - Preserve the bin type using $first since it is constant per bin.
    {
      $group: {
        _id: {
          bin: '$associateBin',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        },
        weight: { $last: '$currentWeight' },
        binType: { $first: '$binData.dustbinType' },
      },
    },

    // 7. Group again by bin to compile an array of daily readings and preserve the bin type.
    {
      $group: {
        _id: '$_id.bin',
        data: { $push: { date: '$_id.date', weight: '$weight' } },
        binType: { $first: '$binType' },
      },
    },
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
 * GET /api/v1/analytics/activityFeed
 *
 * This endpoint provides a chronological list of significant activity events.
 * For example, it can return the days with the lowest or highest diversion or recycling rates.
 *
 * In this sample implementation, we simply fetch the waste data for today,
 * then identify the day (or record) with the minimum and maximum diversion rates.
 * You can expand this logic to include more sophisticated event detection.
 */
export const getActivityFeed = asyncHandler(async (req, res) => {
  // For demonstration, we use a 7-day period for activity feed.
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
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
    { $match: { 'binData.branchAddress': mongoose.Types.ObjectId(branchId) } },
    { $sort: { createdAt: 1 } },
  ];

  const activities = await Waste.aggregate(pipeline);
  // Here, you could further process activities to extract key events (min/max diversion)
  return res
    .status(200)
    .json(new ApiResponse(200, activities, 'Activity feed data retrieved successfully'));
});

/**
 * GET /api/v1/analytics/adminLeaderboard
 *
 * This endpoint returns leaderboard data.
 * For SuperAdmin, it ranks companies by a metric (e.g., diversion rate);
 * for other admin roles, it ranks offices (branch addresses) within their company.
 *
 * For demonstration, we rank based on total waste (using the last reading per bin).
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
    // If companyId equals "all", we remove the company filter.
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
