// dashboard.analytics.controllers.js
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { OrgUnit } from '../models/orgUnit.model.js';
import mongoose from 'mongoose';
import { startOfDay, endOfDay, format, startOfMonth, endOfMonth, subDays } from 'date-fns';

/**
 * GET /api/v1/analytics/binStatus
 * -------------------------------------------
 * Retrieves real-time bin status data for a given branch.
 *
 * Query Parameters:
 *  - branchId (required): The ObjectId of the branch (BranchAddress) for which to fetch bin data.
 *
 * Returns an array of dustbin records including:
 *  - _id, dustbinType (as binName), currentWeight, binCapacity,
 *  - isActive flag (true if the bin is not marked as cleaned).
 */
export const getBinStatus = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, 'branchId is required');
  }
  try {
    // Find all dustbins associated with the given branch.
    const bins = await Dustbin.find({ branchAddress: branchId }).lean();
    // Map bins to include isActive flag (here, assume active if not cleaned).
    const binStatus = bins.map((bin) => ({
      _id: bin._id,
      binName: bin.dustbinType,
      currentWeight: bin.currentWeight,
      binCapacity: bin.binCapacity,
      isActive: !bin.isCleaned, // Adjust logic if needed
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
 * -------------------------------------------
 * Retrieves minimal overview data for an employee or bin display user.
 *
 * Query Parameters:
 *  - branchId (required): The ObjectId of the branch.
 *
 * Returns an object with:
 *  - todayWaste: Sum of today's waste (aggregated from Waste entries for this branch).
 *  - trendData: An array of hourly aggregated waste data for today.
 *  - branchContribution: The branch's contribution percentage relative to company total waste.
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

    // Pipeline to group Waste entries by hour for the branch.
    const trendPipeline = [
      {
        $match: {
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        // Join with dustbins to filter by branch.
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

    // Calculate today's total waste for the branch.
    const branchWasteAgg = await Waste.aggregate([
      {
        $match: {
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
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
          _id: null,
          totalBranchWaste: { $sum: '$currentWeight' },
        },
      },
    ]);
    const todayWaste = branchWasteAgg[0]?.totalBranchWaste || 0;

    // For branchContribution, compute total waste for the company.
    // First, find the branch record to extract company id.
    const branch = await BranchAddress.findById(branchId).lean();
    if (!branch) {
      throw new ApiError(404, 'Branch not found');
    }
    const companyId = branch.associatedCompany;
    // Find all branches for the company.
    const companyBranches = await BranchAddress.find({ associatedCompany: companyId })
      .select('_id')
      .lean();
    const branchIds = companyBranches.map((b) => b._id);
    // Aggregate total company waste.
    const companyWasteAgg = await Waste.aggregate([
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
          'binData.branchAddress': { $in: branchIds },
        },
      },
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
  } catch (error) {
    console.error('Error in getMinimalOverview:', error);
    throw new ApiError(500, 'Failed to fetch minimal overview data');
  }
});

/**
 * GET /api/v1/analytics/overview
 * -------------------------------------------
 * Retrieves an aggregated overview of metrics for admin dashboards.
 *
 * Query Parameters:
 *  - month (required): The month filter in 'YYYY-MM' format.
 *  - orgUnitId (optional): Filter by specific organizational unit.
 *  - companyId (optional): For SuperAdmin to filter by company.
 *
 * Returns an object with:
 *  - officeLocations: Count of branch addresses under the selected OrgUnit.
 *  - wasteBins: Count of dustbins for the branches in the OrgUnit.
 *  - totalWaste: Aggregated waste for the selected month.
 *  - diversionRate: Percentage of waste diverted from landfill.
 */
export const getOverviewData = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month) {
    throw new ApiError(400, 'Month is required in YYYY-MM format');
  }
  try {
    // Compute date range for the given month.
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

    // Retrieve branch addresses filtered by orgUnit if provided.
    // If orgUnitId is provided, we assume that branch addresses are linked via OrgUnit.
    // Otherwise, if companyId is provided or user’s company is used, fetch all branches for that company.
    let branchFilter = {};
    if (orgUnitId) {
      // Find all Branch OrgUnits with parent = orgUnitId or directly matching orgUnitId.
      const orgUnits = await OrgUnit.find({ parent: orgUnitId, type: 'Branch' })
        .select('_id')
        .lean();
      const branchIds = orgUnits.map((unit) => unit.branchAddress).filter(Boolean);
      branchFilter = { _id: { $in: branchIds } };
    } else if (companyId) {
      branchFilter = { associatedCompany: companyId, isdeleted: false };
    }

    // Count office locations.
    const officeLocations = await BranchAddress.countDocuments(branchFilter);

    // Count waste bins for these branches.
    const branchAddresses = await BranchAddress.find(branchFilter).select('_id').lean();
    const branchIds = branchAddresses.map((b) => b._id);
    const wasteBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

    // Aggregate total waste for the selected month from Waste entries for these branches.
    const wasteAgg = await Waste.aggregate([
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
          'binData.branchAddress': { $in: branchIds },
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          totalWaste: { $sum: '$currentWeight' },
        },
      },
    ]);
    const totalWaste = wasteAgg[0]?.totalWaste || 0;

    // Compute diversionRate as percentage of waste from bins not "General Waste".
    const diversionAgg = await Waste.aggregate([
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
          'binData.branchAddress': { $in: branchIds },
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$binData.dustbinType',
          weight: { $sum: '$currentWeight' },
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
 * -------------------------------------------
 * Retrieves time-series waste data grouped by waste stream for a selected month.
 *
 * Query Parameters:
 *  - month (required): Month in 'YYYY-MM' format.
 *  - orgUnitId (optional): Filter by OrgUnit.
 *  - companyId (optional): For SuperAdmin to filter by company.
 *
 * Returns an array of data points where each data point contains:
 *  - date (string)
 *  - waste amounts for each waste stream (e.g., Landfill, Commingled, Organic, Paper & Cardboard, Glass)
 */
export const getWasteByStream = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month) {
    throw new ApiError(400, 'Month is required in YYYY-MM format');
  }
  try {
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

    // Determine branch addresses based on filters
    let branchFilter = {};
    if (orgUnitId) {
      const orgUnits = await OrgUnit.find({ parent: orgUnitId, type: 'Branch' })
        .select('_id')
        .lean();
      const branchIds = orgUnits.map((unit) => unit.branchAddress).filter(Boolean);
      branchFilter = { _id: { $in: branchIds } };
    } else if (companyId) {
      branchFilter = { associatedCompany: companyId, isdeleted: false };
    }

    const branchAddresses = await BranchAddress.find(branchFilter).select('_id').lean();
    const branchIds = branchAddresses.map((b) => b._id);

    const pipeline = [
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
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
          'binData.branchAddress': { $in: branchIds },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            binType: '$binData.dustbinType',
          },
          totalWeight: { $sum: '$currentWeight' },
        },
      },
      {
        $group: {
          _id: '$_id.date',
          streams: {
            $push: { binType: '$_id.binType', weight: '$totalWeight' },
          },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          streams: 1,
        },
      },
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
 * -------------------------------------------
 * Retrieves a ranked list of OrgUnits (or branches) based on total waste generated.
 *
 * Query Parameters:
 *  - month (required): Month in 'YYYY-MM' format.
 *  - orgUnitId (required): Parent OrgUnit to rank its child units.
 *  - companyId (optional): For SuperAdmin to filter by company.
 *
 * Returns an array of ranked items, each containing:
 *  - id, name, totalWaste, and optionally diversionRate.
 */
export const getLeaderboard = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month || !orgUnitId) {
    throw new ApiError(400, 'Month and orgUnitId are required');
  }
  try {
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

    // Get branch addresses under the specified OrgUnit.
    // For simplicity, assume OrgUnit contains branchAddress reference.
    const orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      throw new ApiError(404, 'OrgUnit not found');
    }
    // Find branches under this OrgUnit.
    const branches = await BranchAddress.find({
      associatedCompany: companyId || orgUnit.associatedCompany,
    })
      .select('_id')
      .lean();
    const branchIds = branches.map((b) => b._id);

    const pipeline = [
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
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
          'binData.branchAddress': { $in: branchIds },
        },
      },
      {
        $group: {
          _id: '$binData.branchAddress',
          totalWaste: { $sum: '$currentWeight' },
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
 * -------------------------------------------
 * Retrieves a chronological list of activity events for a selected month and OrgUnit.
 *
 * Query Parameters:
 *  - month (required): Month in 'YYYY-MM' format.
 *  - orgUnitId (optional): Filter by OrgUnit.
 *  - companyId (optional): For SuperAdmin to filter by company.
 *
 * Returns an array of activity objects, each containing:
 *  - id, title, description, and timestamp.
 */
export const getActivityFeed = asyncHandler(async (req, res) => {
  const { month, orgUnitId, companyId } = req.query;
  if (!month) {
    throw new ApiError(400, 'Month is required in YYYY-MM format');
  }
  try {
    const startDate = startOfMonth(new Date(`${month}-01`));
    const endDate = endOfMonth(new Date(`${month}-01`));

    // For demonstration, we assume activities are stored in Waste events.
    // In a real implementation, activities might come from a dedicated collection.
    const pipeline = [
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      // Optionally filter by OrgUnit: this requires joining with dustbins and branchAddresses.
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
      // If orgUnitId is provided, filter branches that belong to that OrgUnit.
      orgUnitId
        ? {
            $match: { 'branchData.orgUnit': new mongoose.Types.ObjectId(orgUnitId) },
          }
        : { $match: {} },
      // Optionally filter by companyId.
      companyId
        ? {
            $match: { 'branchData.associatedCompany': new mongoose.Types.ObjectId(companyId) },
          }
        : { $match: {} },
      {
        $sort: { createdAt: -1 },
      },
      {
        $project: {
          _id: 1,
          title: { $literal: 'Activity Event' }, // In real scenario, title and description would be stored.
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
