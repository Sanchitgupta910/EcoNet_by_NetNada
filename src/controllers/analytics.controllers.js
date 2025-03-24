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
 * getDateRangeFromFilter:
 * Returns the start and end dates based on the provided filter.
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
  return { startDate, endDate };
};

/**
 * getPreviousDateRange:
 * Returns the previous period's date range based on the current filter.
 */
const getPreviousDateRange = (filter, now = new Date()) => {
  let previousStartDate, previousEndDate;
  switch (filter) {
    case 'today':
      previousStartDate = startOfDay(subDays(now, 1));
      previousEndDate = endOfDay(subDays(now, 1));
      break;
    case 'thisWeek':
      previousStartDate = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      previousEndDate = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      break;
    case 'thisMonth': {
      const lastMonthDate = subMonths(now, 1);
      previousStartDate = startOfMonth(lastMonthDate);
      previousEndDate = endOfMonth(lastMonthDate);
      break;
    }
    case 'lastMonth':
      previousStartDate = startOfMonth(now);
      previousEndDate = endOfMonth(now);
      break;
    default:
      previousStartDate = startOfDay(subDays(now, 1));
      previousEndDate = endOfDay(subDays(now, 1));
      break;
  }
  return { previousStartDate, previousEndDate };
};

/**
 * aggregateWasteData:
 * Aggregates waste data over a date range for the given branchIds.
 *
 * For each bin on each day, it selects the latest reading and sums these up.
 *
 * Formulas:
 *   totalWaste = Σ (latest reading per bin per day)
 *   landfillDiversion = Σ (latest reading per bin per day for bins with dustbinType !== "General Waste")
 *
 * Returns an object: { totalWaste, landfillDiversion }
 */
const aggregateWasteData = async (rangeStart, rangeEnd, branchIds) => {
  const wasteAgg = await Waste.aggregate([
    { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
    { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: { associateBin: '$associateBin', day: '$day' },
        latestWaste: { $first: '$currentWeight' },
      },
    },
    {
      $group: {
        _id: '$_id.associateBin',
        cumulativeWaste: { $sum: '$latestWaste' },
      },
    },
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
  ]);

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

/**
 * aggregateRecyclingWasteData:
 * Aggregates waste data over a date range, but only for bins where dustbinType === "Recycling".
 *
 * Returns the total recycling waste computed as the sum of the latest reading per recycling bin per day.
 */
const aggregateRecyclingWasteData = async (rangeStart, rangeEnd, branchIds) => {
  const wasteAgg = await Waste.aggregate([
    { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
    { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: { associateBin: '$associateBin', day: '$day' },
        latestWaste: { $first: '$currentWeight' },
      },
    },
    {
      $group: {
        _id: '$_id.associateBin',
        cumulativeWaste: { $sum: '$latestWaste' },
      },
    },
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
    { $match: { 'binDetails.dustbinType': 'Commingled' } },
  ]);

  let recyclingWaste = 0;
  wasteAgg.forEach((record) => {
    recyclingWaste += record.cumulativeWaste;
  });
  return recyclingWaste;
};

/**
 * getLatestBinWeight
 * GET /api/v1/analytics/latestBinWeight
 * Retrieves the latest waste record for a specific bin (today's data).
 * Query Params:
 *   - binId: (required) The ObjectId of the dustbin.
 */
const getLatestBinWeight = asyncHandler(async (req, res) => {
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
 * getBinStatus
 * GET /api/v1/analytics/binStatus
 * Retrieves real-time status for all bins in a branch.
 * Query Params:
 *   - branchId: (required) The branch ObjectId.
 */
const getBinStatus = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
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
});

/**
 * getAdminOverview
 * GET /api/v1/analytics/adminOverview
 * Computes admin-level metrics.
 * Query Params:
 *   - companyId (optional)
 *   - orgUnitId (optional)
 *   - filter (required): "today", "thisWeek", "thisMonth", "lastMonth"
 *
 * Metrics:
 *   - totalBins: Count of bins in filtered branches.
 *   - totalWaste: Sum of latest reading per bin per day.
 *   - landfillDiversionPercentage = (landfillDiversion / totalWaste) * 100.
 *   - totalWasteTrend: Percentage change in totalWaste compared to previous period.
 *   - landfillDiversionTrend: Percentage change in landfillDiversion compared to previous period.
 */
const getAdminOverview = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId, filter } = req.query;
  const now = new Date();
  const { startDate, endDate } = getDateRangeFromFilter(filter, now);
  const { previousStartDate, previousEndDate } = getPreviousDateRange(filter, now);

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

  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });
  const { totalWaste, landfillDiversion } = await aggregateWasteData(startDate, endDate, branchIds);
  const currentDiversionPercentage =
    totalWaste > 0 ? Number(((landfillDiversion / totalWaste) * 100).toFixed(2)) : 0;
  const { totalWaste: prevTotalWaste, landfillDiversion: prevLandfillDiversion } =
    await aggregateWasteData(previousStartDate, previousEndDate, branchIds);
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
 * getMinimalOverview
 * GET /api/v1/analytics/minimalOverview
 * Computes branch-level metrics for the employee dashboard.
 * Query Params:
 *   - branchId (required)
 *
 * Metrics:
 *   - todayWaste: Sum of latest reading per bin for today.
 *   - branchContribution: (todayWaste / totalCompanyWaste) * 100, where totalCompanyWaste is computed from today's data across all branches in the company.
 *   - trendData: Daily aggregated waste data for today (for charting).
 */
const getMinimalOverview = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

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

  const branchWasteAgg = await Waste.aggregate([
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
    { $match: { 'binData.branchAddress': new mongoose.Types.ObjectId(branchId) } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$associateBin', latestWeight: { $first: '$currentWeight' } } },
    { $group: { _id: null, totalBranchWaste: { $sum: '$latestWeight' } } },
  ]);
  const todayWaste = branchWasteAgg[0]?.totalBranchWaste || 0;

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
});

/**
 * getWasteTrendChart
 * GET /api/v1/analytics/wasteTrendChart
 * Returns time-series waste data for charting.
 * Query Params:
 *   - branchId (optional)
 *   - companyId (optional)
 *   - filter (optional)
 *
 * If branchId is provided, aggregates at branch level; else at company level.
 */
const getWasteTrendChart = asyncHandler(async (req, res) => {
  const { branchId, companyId, filter } = req.query;
  let branchIds = [];
  if (!branchId && !companyId) {
    const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
    branchIds = allBranches.map((b) => b._id);
  } else if (branchId) {
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
  }

  const { startDate, endDate } = getDateRangeFromFilter(filter, new Date());
  const isToday = filter === 'today';

  const baseStages = [
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
  ];

  let pipeline;
  if (isToday) {
    pipeline = [
      ...baseStages,
      { $sort: { associateBin: 1, createdAt: -1 } },
      {
        $group: {
          _id: { bin: '$associateBin', hour: { $hour: '$createdAt' } },
          weight: { $first: '$currentWeight' },
          binType: { $first: '$binData.dustbinType' },
        },
      },
      {
        $group: {
          _id: { binType: '$binType', hour: '$_id.hour' },
          totalWeight: { $sum: '$weight' },
        },
      },
      { $sort: { '_id.hour': 1 } },
      {
        $group: {
          _id: '$_id.binType',
          data: { $push: { hour: '$_id.hour', weight: '$totalWeight' } },
        },
      },
      { $project: { _id: 0, binName: '$_id', data: 1 } },
      { $sort: { binName: 1 } },
    ];
  } else {
    pipeline = [
      ...baseStages,
      { $sort: { associateBin: 1, createdAt: 1 } },
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
      {
        $group: {
          _id: { binType: '$binType', date: '$_id.date' },
          totalWeight: { $sum: '$weight' },
        },
      },
      { $sort: { '_id.date': 1 } },
      {
        $group: {
          _id: '$_id.binType',
          data: { $push: { date: '$_id.date', weight: '$totalWeight' } },
        },
      },
      { $project: { _id: 0, binName: '$_id', data: 1 } },
      { $sort: { binName: 1 } },
    ];
  }

  try {
    const trendData = await Waste.aggregate(pipeline);
    return res
      .status(200)
      .json(new ApiResponse(200, trendData, 'Waste trend chart data retrieved successfully'));
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch waste trend chart data');
  }
});

/**
 * getWasteTrendComparison
 * GET /api/v1/analytics/wasteTrendComparison
 * Compares waste generation between two consecutive periods.
 * Query Params:
 *   - branchId (required)
 *   - filter (optional)
 *
 * Formula:
 *   percentageChange = ((thisPeriodWaste - previousPeriodWaste) / previousPeriodWaste) * 100
 */
const getWasteTrendComparison = asyncHandler(async (req, res) => {
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
      { $group: { _id: null, totalWaste: { $sum: '$latestWeight' } } },
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
 * getWasteLast7Days
 * GET /api/v1/analytics/wasteLast7Days
 * Retrieves waste data for the last 7 days (using the last reading per bin per day).
 * Query Params:
 *   - branchId (required)
 */
const getWasteLast7Days = asyncHandler(async (req, res) => {
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
 * getActivityFeed
 * GET /api/v1/analytics/activityFeed
 * Retrieves activity feed data.
 * Query Params:
 *   - branchId (optional) or companyId (optional)
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
    const activities = await Waste.aggregate(pipeline);
    return res
      .status(200)
      .json(new ApiResponse(200, activities, 'Activity feed data retrieved successfully'));
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch activity feed data');
  }
});

/**
 * getRecyclingOverview
 * NEW ENDPOINT
 * GET /api/v1/analytics/recyclingOverview
 *
 * Computes the recycling rate and its trend over a given date filter.
 * Query Params:
 *   - companyId (optional): If provided, filters to that company; if not, aggregates for all companies.
 *   - orgUnitId (optional): If provided, further filters by the OrgUnit.
 *   - filter (required): "today", "thisWeek", "thisMonth", "lastMonth"
 *
 * Formulas:
 *   For the current period:
 *     - recyclingWaste = Sum of the latest reading per recycling bin (dustbinType === "Recycling") for each day.
 *     - totalWaste = Sum of the latest reading per bin (all bins) for each day.
 *     - currentRecyclingRate = (recyclingWaste / totalWaste) * 100
 *
 *   For the previous period (using the same filter):
 *     - prevRecyclingWaste computed similarly.
 *     - recyclingTrend = ((recyclingWaste - prevRecyclingWaste) / prevRecyclingWaste) * 100  (if prevRecyclingWaste > 0, else 0)
 *
 * Returns an object: { totalWaste, recyclingRate, recyclingTrend }
 */
const getRecyclingOverview = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId, filter } = req.query;
  const now = new Date();
  const { startDate, endDate } = getDateRangeFromFilter(filter, now);
  const { previousStartDate, previousEndDate } = getPreviousDateRange(filter, now);

  let branchFilter = { isdeleted: false };
  if (companyId) {
    branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
  }
  if (orgUnitId) {
    let orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      const branch = await BranchAddress.findById(orgUnitId).lean();
      if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
      orgUnit = { _id: branch._id, type: 'Branch', branchAddress: branch._id };
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

  const branches = await BranchAddress.find(branchFilter).select('_id').lean();
  const branchIds = branches.map((b) => b._id);
  if (branchIds.length === 0) {
    const overviewData = { totalWaste: 0, recyclingRate: 0, recyclingTrend: 0 };
    return res
      .status(200)
      .json(new ApiResponse(200, overviewData, 'No branches found for the given filter'));
  }

  // Aggregate total waste for current period.
  const { totalWaste } = await aggregateWasteData(startDate, endDate, branchIds);
  // Aggregate recycling waste for current period.
  const recyclingWaste = await aggregateRecyclingWasteData(startDate, endDate, branchIds);
  const currentRecyclingRate =
    totalWaste > 0 ? Number(((recyclingWaste / totalWaste) * 100).toFixed(2)) : 0;

  // Aggregate for previous period.
  const { totalWaste: prevTotalWaste } = await aggregateWasteData(
    previousStartDate,
    previousEndDate,
    branchIds,
  );
  const prevRecyclingWaste = await aggregateRecyclingWasteData(
    previousStartDate,
    previousEndDate,
    branchIds,
  );
  const recyclingTrend =
    prevRecyclingWaste > 0
      ? Number((((recyclingWaste - prevRecyclingWaste) / prevRecyclingWaste) * 100).toFixed(2))
      : 0;

  const overviewData = {
    totalWaste,
    recyclingRate: currentRecyclingRate,
    recyclingTrend,
  };

  return res
    .status(200)
    .json(new ApiResponse(200, overviewData, 'Recycling overview data fetched successfully'));
});
/**
 * getDateRangeForLeaderboard:
 * Determines the date range for the leaderboard aggregation.
 * If today's date is ≤ 7, it uses last month's period;
 * otherwise, it uses the current month's period.
 *
 * @returns {Object} { startDate, endDate, periodLabel }
 */
const getDateRangeForLeaderboard = (now = new Date()) => {
  let periodLabel = 'This Month';
  let startDate, endDate;
  if (now.getDate() <= 7) {
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

/**
 * getLeaderboardData
 *
 * NEW ENDPOINT – GET /api/v1/analytics/leaderboard
 *
 * Depending on the query parameters:
 * - When no company filter is provided, data is grouped by company.
 * - When a company filter is provided, data is grouped by branch (OrgUnit).
 *
 * The endpoint uses waste data from the given period (current month or last month if within the first week),
 * taking the latest reading per bin per day. For each group, it calculates:
 *   - totalWaste: Sum of latest readings per bin.
 *   - landfillDiversion: Sum for bins where dustbinType is not "General Waste".
 *   - diversionPercentage: (landfillDiversion / totalWaste) * 100.
 *
 * The results are sorted in descending order of diversionPercentage.
 *
 * Query Parameters:
 *   - companyId (optional): If provided, leaderboard is computed per branch within that company.
 *
 * Returns:
 *   An object with:
 *     - leaderboard: Array of aggregated records (each with group identifier, totalWaste, diversionPercentage, etc.)
 *     - period: A label indicating which period was used (e.g. "This Month" or "Last Month")
 */
// const getLeaderboardData = asyncHandler(async (req, res) => {
//   const { companyId } = req.query;
//   const now = new Date();
//   const { startDate, endDate, periodLabel } = getDateRangeForLeaderboard(now);

//   // Build branch filter based on query parameters.
//   let branchFilter = { isdeleted: false };
//   if (companyId) {
//     // When company filter is applied, we limit branches to that company.
//     branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
//   }
//   // Get all branches matching the filter.
//   const branches = await BranchAddress.find(branchFilter)
//     .select('_id officeName associatedCompany')
//     .lean();
//   const branchIds = branches.map((b) => b._id);
//   if (branchIds.length === 0) {
//     return res
//       .status(200)
//       .json(
//         new ApiResponse(
//           200,
//           { leaderboard: [], period: periodLabel },
//           'No branches found for the given filter',
//         ),
//       );
//   }

//   // Aggregation pipeline:
//   const pipeline = [
//     // Match waste records within the time range.
//     { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
//     // Create a 'day' field in YYYY-MM-DD format.
//     { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
//     // Sort by bin and createdAt descending to get latest reading per day.
//     { $sort: { associateBin: 1, createdAt: -1 } },
//     // Group by bin and day: select the first (latest) reading.
//     {
//       $group: {
//         _id: { bin: '$associateBin', day: '$day' },
//         latestWaste: { $first: '$currentWeight' },
//       },
//     },
//     // Sum waste per bin for the period.
//     {
//       $group: {
//         _id: '$_id.bin',
//         cumulativeWaste: { $sum: '$latestWaste' },
//       },
//     },
//     // Look up bin details.
//     {
//       $lookup: {
//         from: 'dustbins',
//         localField: '_id',
//         foreignField: '_id',
//         as: 'binDetails',
//       },
//     },
//     { $unwind: '$binDetails' },
//     // Only consider bins that belong to the matched branches.
//     { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
//     // Lookup branch details from BranchAddress collection.
//     {
//       $lookup: {
//         from: 'branchaddresses',
//         localField: 'binDetails.branchAddress',
//         foreignField: '_id',
//         as: 'branchDetails',
//       },
//     },
//     { $unwind: '$branchDetails' },
//   ];

//   // Grouping stage: If company filter is applied, group by branch; otherwise, group by company.
//   if (companyId) {
//     pipeline.push({
//       $group: {
//         _id: '$branchDetails._id',
//         branchName: { $first: '$branchDetails.officeName' },
//         totalWaste: { $sum: '$cumulativeWaste' },
//         landfillDiversion: {
//           $sum: {
//             $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0],
//           },
//         },
//       },
//     });
//   } else {
//     pipeline.push({
//       $group: {
//         _id: '$branchDetails.associatedCompany',
//         companyName: { $first: '$branchDetails.companyName' },
//         totalWaste: { $sum: '$cumulativeWaste' },
//         landfillDiversion: {
//           $sum: {
//             $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0],
//           },
//         },
//       },
//     });
//   }

//   // Project the diversion percentage.
//   pipeline.push({
//     $project: {
//       totalWaste: 1,
//       landfillDiversion: 1,
//       diversionPercentage: {
//         $cond: [
//           { $gt: ['$totalWaste', 0] },
//           { $multiply: [{ $divide: ['$landfillDiversion', '$totalWaste'] }, 100] },
//           0,
//         ],
//       },
//     },
//   });

//   // Sort the results in descending order by diversionPercentage.
//   pipeline.push({ $sort: { diversionPercentage: -1 } });

//   // Execute aggregation.
//   const leaderboard = await Waste.aggregate(pipeline);

//   return res
//     .status(200)
//     .json(
//       new ApiResponse(
//         200,
//         { leaderboard, period: periodLabel },
//         'Leaderboard data fetched successfully',
//       ),
//     );
// });
/**
 * getLeaderboardData
 *
 * NEW ENDPOINT – GET /api/v1/analytics/leaderboard
 *
 * Aggregates waste data based on the selected period. The aggregation takes the latest waste
 * reading per bin per day over the period, sums the readings per bin, then:
 *
 * - When a company filter is applied, groups by branch (using branchDetails.officeName).
 * - When no company filter is provided, groups by the associated company. A lookup to the Company
 *   collection retrieves the company name.
 *
 * For each group, the following is calculated:
 *   - totalWaste: Sum of latest readings per bin.
 *   - landfillDiversion: Sum of readings only for bins whose dustbinType is not "General Waste".
 *   - diversionPercentage: (landfillDiversion / totalWaste) * 100.
 *
 * The results are sorted in descending order by diversionPercentage.
 *
 * Query Parameters:
 *   - companyId (optional): If provided, the leaderboard is computed at branch level for that company.
 *
 * Returns:
 *   An object with:
 *     - leaderboard: Array of aggregated records (each with a name, totalWaste, diversionPercentage, etc.)
 *     - period: A label indicating which period was used (e.g. "This Month" or "Last Month")
 */
const getLeaderboardData = asyncHandler(async (req, res) => {
  const { companyId } = req.query;
  const now = new Date();
  const { startDate, endDate, periodLabel } = getDateRangeForLeaderboard(now);

  // Build branch filter.
  let branchFilter = { isdeleted: false };
  if (companyId) {
    branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
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

  // Aggregation pipeline.
  const pipeline = [
    // Match waste records in the selected period.
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    // Create a 'day' field.
    { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
    // Sort descending to pick the latest record per bin per day.
    { $sort: { associateBin: 1, createdAt: -1 } },
    // Group by bin and day.
    {
      $group: {
        _id: { bin: '$associateBin', day: '$day' },
        latestWaste: { $first: '$currentWeight' },
      },
    },
    // Sum readings per bin.
    {
      $group: {
        _id: '$_id.bin',
        cumulativeWaste: { $sum: '$latestWaste' },
      },
    },
    // Lookup bin details.
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    // Only include bins from the matching branches.
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
    // Lookup branch details.
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

  if (companyId) {
    // Group by branch when a company filter is applied.
    pipeline.push({
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
    });
    pipeline.push({
      $project: {
        totalWaste: 1,
        landfillDiversion: 1,
        diversionPercentage: {
          $cond: [
            { $gt: ['$totalWaste', 0] },
            { $multiply: [{ $divide: ['$landfillDiversion', '$totalWaste'] }, 100] },
            0,
          ],
        },
        name: '$branchName',
      },
    });
  } else {
    // Group by company when no company filter is provided.
    pipeline.push({
      $group: {
        _id: '$branchDetails.associatedCompany',
        totalWaste: { $sum: '$cumulativeWaste' },
        landfillDiversion: {
          $sum: {
            $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0],
          },
        },
      },
    });
    // Lookup company details to get the company name.
    pipeline.push({
      $lookup: {
        from: 'companies',
        localField: '_id',
        foreignField: '_id',
        as: 'companyDetails',
      },
    });
    pipeline.push({ $unwind: '$companyDetails' });
    pipeline.push({
      $project: {
        totalWaste: 1,
        landfillDiversion: 1,
        diversionPercentage: {
          $cond: [
            { $gt: ['$totalWaste', 0] },
            { $multiply: [{ $divide: ['$landfillDiversion', '$totalWaste'] }, 100] },
            0,
          ],
        },
        name: '$companyDetails.CompanyName',
      },
    });
  }

  // Sort the results in descending order of diversionPercentage.
  pipeline.push({ $sort: { diversionPercentage: -1 } });

  const leaderboard = await Waste.aggregate(pipeline);
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
// Export all functions at the end for easier tracking.
export {
  getLatestBinWeight,
  getBinStatus,
  getAdminOverview,
  getMinimalOverview,
  getWasteTrendChart,
  getWasteTrendComparison,
  getWasteLast7Days,
  getActivityFeed,
  getRecyclingOverview,
  getLeaderboardData,
};
