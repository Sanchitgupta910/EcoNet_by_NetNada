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

/**
 * GET /api/v1/analytics/overview
 * Retrieves an aggregated overview of metrics for admin dashboards.
 * Query Parameters:
 *   - month (required): Month in 'YYYY-MM' format.
 *   - orgUnitId (optional): Filter by specific OrgUnit. Pass "all" to ignore filter.
 *   - companyId (optional): For SuperAdmin to filter by company.
 * Returns an object with:
 *   - officeLocations: Count of branch addresses.
 *   - wasteBins: Count of dustbins for the branches.
 *   - totalWaste: Aggregated waste for the selected month.
 *   - diversionRate: Percentage of waste diverted from landfill.
 */
export const getOverviewData = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month) {
    throw new ApiError(400, 'Month is required in YYYY-MM format');
  }
  try {
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

    let branchFilter = {};
    if (orgUnitId && orgUnitId !== 'all') {
      const orgUnits = await OrgUnit.find({ parent: orgUnitId, type: 'Branch' })
        .select('branchAddress')
        .lean();
      const branchIds = orgUnits.map((unit) => unit.branchAddress).filter(Boolean);
      branchFilter = { _id: { $in: branchIds } };
    } else if (companyId) {
      branchFilter = { associatedCompany: companyId, isdeleted: false };
    }

    // Count office locations.
    const officeLocations = await BranchAddress.countDocuments(branchFilter);

    // Count waste bins.
    const branchAddresses = await BranchAddress.find(branchFilter).select('_id').lean();
    const branchIds = branchAddresses.map((b) => b._id);
    const wasteBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

    // For total waste over the month: for each day and each bin, take only the final reading.
    const wasteAgg = await Waste.aggregate([
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
    ]);
    const totalWaste = wasteAgg[0]?.totalWaste || 0;

    // For diversion rate: group final readings by dustbin type.
    const diversionAgg = await Waste.aggregate([
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
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            bin: '$associateBin',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          },
          latestWeight: { $first: '$currentWeight' },
          dustbinType: { $first: '$binData.dustbinType' },
        },
      },
      {
        $group: {
          _id: '$dustbinType',
          weight: { $sum: '$latestWeight' },
        },
      },
    ]);
    let nonGeneralWaste = 0;
    diversionAgg.forEach((item) => {
      if (item._id !== 'General Waste') {
        nonGeneralWaste += item.weight;
      }
    });
    const diversionRate = totalWaste ? Math.round((nonGeneralWaste / totalWaste) * 100) : 0;

    const overviewData = { officeLocations, wasteBins, totalWaste, diversionRate };
    return res
      .status(200)
      .json(new ApiResponse(200, overviewData, 'Overview data retrieved successfully'));
  } catch (error) {
    console.error('Error in getOverviewData:', error);
    throw new ApiError(500, 'Failed to fetch overview data');
  }
});

/**
 * GET /api/v1/analytics/wasteByStream
 * Retrieves time-series waste data grouped by waste stream for a selected month.
 * Query Parameters:
 *   - month (required): Month in 'YYYY-MM' format.
 *   - orgUnitId (optional): Filter by OrgUnit (use "all" to ignore).
 *   - companyId (optional): For SuperAdmin to filter by company.
 * Returns an array of data points with waste amounts per stream.
 */
export const getWasteByStream = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month) {
    throw new ApiError(400, 'Month is required in YYYY-MM format');
  }
  try {
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

    let branchFilter = {};
    if (orgUnitId && orgUnitId !== 'all') {
      const orgUnits = await OrgUnit.find({ parent: orgUnitId, type: 'Branch' })
        .select('branchAddress')
        .lean();
      const branchIds = orgUnits.map((unit) => unit.branchAddress).filter(Boolean);
      branchFilter = { _id: { $in: branchIds } };
    } else if (companyId) {
      branchFilter = { associatedCompany: companyId, isdeleted: false };
    }
    const branchAddresses = await BranchAddress.find(branchFilter).select('_id').lean();
    const branchIds = branchAddresses.map((b) => b._id);

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
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            bin: '$associateBin',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          },
          latestWeight: { $first: '$currentWeight' },
          binType: { $first: '$binData.dustbinType' },
        },
      },
      {
        $group: {
          _id: { date: '$_id.day', binType: '$binType' },
          totalWeight: { $sum: '$latestWeight' },
        },
      },
      { $sort: { '_id.date': 1 } },
      {
        $group: {
          _id: '$_id.date',
          streams: { $push: { binType: '$_id.binType', weight: '$totalWeight' } },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', streams: 1 } },
    ];
    const wasteData = await Waste.aggregate(pipeline);
    return res
      .status(200)
      .json(new ApiResponse(200, wasteData, 'Waste by stream data retrieved successfully'));
  } catch (error) {
    console.error('Error in getWasteByStream:', error);
    throw new ApiError(500, 'Failed to fetch waste by stream data');
  }
});

/**
 * GET /api/v1/analytics/leaderboard
 * Retrieves a ranked list of branches (or OrgUnits) based on total waste generated.
 * Query Parameters:
 *   - month (required): Month in 'YYYY-MM' format.
 *   - orgUnitId (optional): Parent OrgUnit to filter branches (use "all" to ignore).
 *   - companyId (optional): For SuperAdmin to filter by company.
 * Returns an array of ranked items with:
 *   - id, name, totalWaste.
 */
export const getLeaderboard = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month) {
    throw new ApiError(400, 'Month is required');
  }
  try {
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

    let branchFilter = {};
    if (orgUnitId && orgUnitId !== 'all') {
      // Use the branchAddress from the specified OrgUnit.
      const orgUnit = await OrgUnit.findById(orgUnitId).lean();
      if (!orgUnit) {
        throw new ApiError(404, 'OrgUnit not found');
      }
      branchFilter = { _id: orgUnit.branchAddress };
    } else if (companyId) {
      branchFilter = { associatedCompany: companyId, isdeleted: false };
    }
    const branches = await BranchAddress.find(branchFilter).select('_id').lean();
    const branchIds = branches.map((b) => b._id);

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
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            bin: '$associateBin',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          },
          latestWeight: { $first: '$currentWeight' },
          branchAddress: { $first: '$binData.branchAddress' },
        },
      },
      {
        $group: {
          _id: '$branchAddress',
          totalWaste: { $sum: '$latestWeight' },
        },
      },
      {
        $lookup: {
          from: 'branchaddresses',
          localField: '_id',
          foreignField: '_id',
          as: 'branchData',
        },
      },
      { $unwind: '$branchData' },
      {
        $project: {
          _id: 1,
          totalWaste: 1,
          branchName: '$branchData.officeName',
        },
      },
      { $sort: { totalWaste: -1 } },
    ];
    const leaderboardData = await Waste.aggregate(pipeline);
    return res
      .status(200)
      .json(new ApiResponse(200, leaderboardData, 'Leaderboard data retrieved successfully'));
  } catch (error) {
    console.error('Error in getLeaderboard:', error);
    throw new ApiError(500, 'Failed to fetch leaderboard data');
  }
});

/**
 * GET /api/v1/analytics/activityFeed
 * Retrieves a chronological list of activity events for a selected month and OrgUnit.
 * Query Parameters:
 *   - month (required): Month in 'YYYY-MM' format.
 *   - orgUnitId (optional): Filter by OrgUnit (use "all" to ignore).
 *   - companyId (optional): For SuperAdmin to filter by company.
 * Returns an array of activity objects.
 */
export const getActivityFeed = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month) {
    throw new ApiError(400, 'Month is required in YYYY-MM format');
  }
  try {
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

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
        $lookup: {
          from: 'branchaddresses',
          localField: 'binData.branchAddress',
          foreignField: '_id',
          as: 'branchData',
        },
      },
      { $unwind: '$branchData' },
      // Apply OrgUnit filter only if orgUnitId is provided and not "all"
      ...(orgUnitId && orgUnitId !== 'all'
        ? [
            {
              $match: { 'branchData.orgUnit': new mongoose.Types.ObjectId(orgUnitId) },
            },
          ]
        : []),
      // Apply company filter if provided.
      ...(companyId
        ? [
            {
              $match: { 'branchData.associatedCompany': new mongoose.Types.ObjectId(companyId) },
            },
          ]
        : []),
      { $sort: { createdAt: -1 } },
      {
        $project: {
          _id: 1,
          title: { $literal: 'Activity Event' },
          description: { $literal: 'Activity description goes here.' },
          timestamp: { $dateToString: { format: '%Y-%m-%d %H:%M', date: '$createdAt' } },
        },
      },
    ];
    const activities = await Waste.aggregate(pipeline);
    return res
      .status(200)
      .json(new ApiResponse(200, activities, 'Activity feed retrieved successfully'));
  } catch (error) {
    console.error('Error in getActivityFeed:', error);
    throw new ApiError(500, 'Failed to fetch activity feed');
  }
});
