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
 * Helper: returns start and end of the day in UTC
 */
const getUTCDayRange = (date) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const startDate = new Date(Date.UTC(year, month, day, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  return { startDate, endDate };
};

/**
 * getDateRangeFromFilterUTC:
 * Returns the start and end dates based on the provided filter, using UTC boundaries.
 */
const getDateRangeFromFilterUTC = (filter, now = new Date()) => {
  let startDate, endDate;
  switch (filter) {
    case 'today': {
      ({ startDate, endDate } = getUTCDayRange(now));
      break;
    }
    case 'thisWeek': {
      // Assume week starts on Monday (UTC)
      const dayOfWeek = now.getUTCDay(); // 0 (Sun) to 6 (Sat)
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
      // Last day of last month: first day of this month minus 1ms
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
 * Updated here to use UTC boundaries for the 'today' case.
 */
const getPreviousDateRange = (filter, now = new Date()) => {
  let previousStartDate, previousEndDate;
  switch (filter) {
    case 'today': {
      const prevDate = new Date(now);
      prevDate.setUTCDate(now.getUTCDate() - 1);
      ({ startDate: previousStartDate, endDate: previousEndDate } = getUTCDayRange(prevDate));
      break;
    }
    case 'thisWeek': {
      const prevDate = new Date(now);
      prevDate.setUTCDate(now.getUTCDate() - 7);
      ({ startDate: previousStartDate, endDate: previousEndDate } = getUTCDayRange(prevDate));
      break;
    }
    case 'thisMonth': {
      const prevDate = new Date(now);
      prevDate.setUTCMonth(now.getUTCMonth() - 1);
      previousStartDate = new Date(Date.UTC(prevDate.getUTCFullYear(), prevDate.getUTCMonth(), 1, 0, 0, 0));
      // For simplicity, set previousEndDate as the last day of that month using 31; if no data exists for extra days it won't matter.
      previousEndDate = new Date(Date.UTC(prevDate.getUTCFullYear(), prevDate.getUTCMonth(), 31, 23, 59, 59, 999));
      break;
    }
    case 'lastMonth': {
      const prevDate = new Date(now);
      prevDate.setUTCMonth(now.getUTCMonth() - 2);
      previousStartDate = new Date(Date.UTC(prevDate.getUTCFullYear(), prevDate.getUTCMonth(), 1, 0, 0, 0));
      previousEndDate = new Date(Date.UTC(prevDate.getUTCFullYear(), prevDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      break;
    }
    default: {
      const prevDate = new Date(now);
      prevDate.setUTCDate(now.getUTCDate() - 1);
      ({ startDate: previousStartDate, endDate: previousEndDate } = getUTCDayRange(prevDate));
      break;
    }
  }
  return { previousStartDate, previousEndDate };
};

/**
 * getLatestWastePerBin:
 * Returns an array of objects { bin: <binId>, latestWeight: <number>, dustbinType: <string> }
 * using a unified aggregation pipeline that:
 *  1. Filters records by the UTC-based date range.
 *  2. Looks up bin details and filters by branch.
 *  3. Adds a 'day' field based on createdAt in UTC.
 *  4. Sorts by associateBin and createdAt descending.
 *  5. Groups by {bin, day} and selects the latest reading.
 */
const getLatestWastePerBin = async (rangeStart, rangeEnd, branchIds) => {
  const results = await Waste.aggregate([
    // Filter waste records within the specified UTC-based date range.
    { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
    // Lookup bin details for branch filtering.
    {
      $lookup: {
        from: 'dustbins',
        localField: 'associateBin',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    // Filter to include only bins from the specified branch IDs.
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
    // Add a 'day' field in "YYYY-MM-dd" format in UTC.
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
      },
    },
    // Sort by associateBin and createdAt descending so that the latest record per bin is first.
    { $sort: { associateBin: 1, createdAt: -1 } },
    // Group by both bin and day, picking the latest reading.
    {
      $group: {
        _id: { bin: '$associateBin', day: '$day' },
        latestWeight: { $first: '$currentWeight' },
        dustbinType: { $first: '$binDetails.dustbinType' },
      },
    },
  ]);
  return results;
};

/**
 * aggregateWasteData:
 * Aggregates waste data over a date range for the given branchIds.
 * For each bin on each day, it selects the latest reading and sums these up.
 * Formulas:
 *   totalWaste = Σ (latest reading per bin per day)
 *   landfillDiversion = Σ (latest reading per bin per day for bins with dustbinType !== "General Waste")
 * Returns an object: { totalWaste, landfillDiversion }
 */
const aggregateWasteData = async (rangeStart, rangeEnd, branchIds) => {
  const wasteAgg = await Waste.aggregate([
    // Filter records within the specified UTC-based date range.
    { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
    // Immediately lookup bin details.
    {
      $lookup: {
        from: 'dustbins',
        localField: 'associateBin',
        foreignField: '_id',
        as: 'binDetails',
      },
    },
    { $unwind: '$binDetails' },
    // Filter records by branch using the looked-up binDetails.
    { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
    // Add a 'day' field with an explicit UTC timezone.
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
      },
    },
    // Sort records by bin and createdAt descending.
    { $sort: { associateBin: 1, createdAt: -1 } },
    // Group by bin and day: pick the latest reading.
    {
      $group: {
        _id: { associateBin: '$associateBin', day: '$day' },
        latestWeight: { $first: '$currentWeight' },
        dustbinType: { $first: '$binDetails.dustbinType' },
      },
    },
    // Sum the latest readings across all bins.
    {
      $group: {
        _id: null,
        totalWaste: { $sum: '$latestWeight' },
        landfillDiversion: {
          $sum: { $cond: [{ $ne: ['$dustbinType', 'General Waste'] }, '$latestWeight', 0] },
        },
      },
    },
  ]);
  if (wasteAgg.length === 0) {
    return { totalWaste: 0, landfillDiversion: 0 };
  }
  return {
    totalWaste: wasteAgg[0].totalWaste,
    landfillDiversion: wasteAgg[0].landfillDiversion,
  };
};

/**
 * aggregateRecyclingWasteData:
 * Aggregates waste data over a date range, but only for bins where dustbinType === "Recycling".
 * Returns the total recycling waste computed as the sum of the latest reading per recycling bin per day.
 */
const aggregateRecyclingWasteData = async (rangeStart, rangeEnd, branchIds) => {
  const wasteAgg = await Waste.aggregate([
    { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
      },
    },
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

  // Use UTC boundaries for today's date.
  const { startDate: todayStart, endDate: todayEnd } = getUTCDayRange(new Date());
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
  // Use our UTC-based helper to compute the current period's date range.
  const { startDate, endDate } = getDateRangeFromFilterUTC(filter, now);
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

  // Retrieve branches matching the filter.
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

  // Compute total bins count for these branches.
  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

  // Use unified helper for current period.
  const latestRecords = await getLatestWastePerBin(startDate, endDate, branchIds);
  const totalWaste = latestRecords.reduce((sum, record) => sum + record.latestWeight, 0);
  const landfillDiversion = latestRecords.reduce(
    (sum, record) => (record.dustbinType !== 'General Waste' ? sum + record.latestWeight : sum),
    0
  );
  const currentDiversionPercentage =
    totalWaste > 0 ? Number(((landfillDiversion / totalWaste) * 100).toFixed(2)) : 0;

  // Use unified helper for previous period.
  const prevRecords = await getLatestWastePerBin(previousStartDate, previousEndDate, branchIds);
  const prevTotalWaste = prevRecords.reduce((sum, record) => sum + record.latestWeight, 0);
  const prevLandfillDiversion = prevRecords.reduce(
    (sum, record) => (record.dustbinType !== 'General Waste' ? sum + record.latestWeight : sum),
    0
  );
  const totalWasteTrend =
    prevTotalWaste > 0
      ? Number((((totalWaste - prevTotalWaste) / prevTotalWaste) * 100).toFixed(2))
      : 0;
  const landfillDiversionTrend =
    prevLandfillDiversion > 0
      ? Number((((landfillDiversion - prevLandfillDiversion) / prevLandfillDiversion) * 100).toFixed(2))
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
  const { startDate: todayStart, endDate: todayEnd } = getUTCDayRange(now);

  // Trend data pipeline for charting (aggregated by day)
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
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
        totalWeight: { $sum: '$currentWeight' },
      },
    },
    { $sort: { '_id.date': 1 } },
  ];
  const trendData = await Waste.aggregate(trendPipeline);

  // Pipeline for computing today's branch waste using latest reading per bin.
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
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: '$associateBin',
        latestWeight: { $first: '$currentWeight' },
      },
    },
    { $group: { _id: null, totalBranchWaste: { $sum: '$latestWeight' } } },
  ]);
  const todayWaste = branchWasteAgg[0]?.totalBranchWaste || 0;

  // Compute branch contribution using company's aggregated data for today.
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
 *
 * Query Parameters:
 *   - branchId (optional): The ObjectId of a specific branch.
 *   - companyId (optional): If provided and not set to "all" or "All Organizations", aggregates data across all branches for that company.
 *   - orgUnitId (optional): If provided, aggregates data across all branches associated with that organization unit.
 *   - filter (optional): One of "today", "thisWeek", "thisMonth", or "lastMonth". Defaults to "today".
 *   - zoomDate (optional): An ISO date string. When provided (with non-"today" filters), returns hourly aggregation for that day.
 *
 * Expected Behavior:
 *   - For "today" (or when zoomDate is provided): aggregates data by hour.
 *   - For other filters: aggregates data by date using only the latest reading per bin per day.
 */
const getWasteTrendChart = asyncHandler(async (req, res) => {
  try {
    let { branchId, companyId, orgUnitId, filter, zoomDate } = req.query;
    if (!filter) filter = 'today';

    // Sanitize companyId if it is "all" or "All Organizations"
    if (
      companyId &&
      typeof companyId === 'string' &&
      (companyId.toLowerCase() === 'all' || companyId.toLowerCase() === 'all organizations')
    ) {
      console.log('Sanitizing companyId; received:', companyId);
      companyId = undefined;
    }

    // Determine branch IDs based on filters.
    let branchIds = [];
    if (!branchId && !companyId && !orgUnitId) {
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
    } else if (orgUnitId) {
      if (!mongoose.Types.ObjectId.isValid(orgUnitId))
        throw new ApiError(400, 'Invalid orgUnitId format');
      let orgUnit = await OrgUnit.findById(orgUnitId).lean();
      if (!orgUnit) {
        const branch = await BranchAddress.findById(orgUnitId).lean();
        if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
        orgUnit = { _id: branch._id, type: 'Branch', branchAddress: branch._id };
      }
      switch (orgUnit.type) {
        case 'Branch':
          if (orgUnit.branchAddress)
            branchIds = [new mongoose.Types.ObjectId(orgUnit.branchAddress)];
          else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
          break;
        case 'City':
          branchIds = (
            await BranchAddress.find({ city: orgUnit.name, isdeleted: false }).select('_id').lean()
          ).map((b) => b._id);
          break;
        case 'Country':
          branchIds = (
            await BranchAddress.find({ country: orgUnit.name, isdeleted: false })
              .select('_id')
              .lean()
          ).map((b) => b._id);
          break;
        case 'Region':
        case 'State':
          branchIds = (
            await BranchAddress.find({ subdivision: orgUnit.name, isdeleted: false })
              .select('_id')
              .lean()
          ).map((b) => b._id);
          break;
        default:
          const allBranchesOrg = await BranchAddress.find({ isdeleted: false })
            .select('_id')
            .lean();
          branchIds = allBranchesOrg.map((b) => b._id);
      }
    }
    if (branchIds.length === 0) throw new ApiError(404, 'No branches found for the given filter');

    // Determine date range.
    const now = new Date();
    let startDate, endDate;
    if (zoomDate && filter !== 'today') {
      const zoomedDate = new Date(zoomDate);
      if (isNaN(zoomedDate)) throw new ApiError(400, 'Invalid zoomDate format');
      ({ startDate, endDate } = getUTCDayRange(zoomedDate));
      console.log('Zoom mode active for date:', zoomedDate);
    } else {
      if (filter === 'today') {
        ({ startDate, endDate } = getUTCDayRange(now));
      } else {
        ({ startDate, endDate } = getDateRangeFromFilterUTC(filter, now));
      }
    }
    console.log('Date range:', { startDate, endDate });

    // Base aggregation stages.
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
    if (filter === 'today' || (zoomDate && filter !== 'today')) {
      // Hourly pivot aggregation.
      pipeline = [
        ...baseStages,
        { $sort: { createdAt: 1 } },
        {
          $group: {
            _id: {
              hour: { $hour: '$createdAt' },
              binType: '$binData.dustbinType',
            },
            totalWeight: { $sum: '$currentWeight' },
          },
        },
        { $sort: { '_id.hour': 1 } },
        {
          $group: {
            _id: '$_id.hour',
            values: { $push: { binType: '$_id.binType', weight: '$totalWeight' } },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            time: '$_id',
            _id: 0,
            values: 1,
          },
        },
      ];
    } else {
      // Daily pivot aggregation using only the latest record per bin per day.
      pipeline = [
        ...baseStages,
        {
          $addFields: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          },
        },
        { $sort: { associateBin: 1, createdAt: -1 } },
        {
          $group: {
            _id: { associateBin: '$associateBin', day: '$day' },
            latestWeight: { $first: '$currentWeight' },
            binType: { $first: '$binData.dustbinType' },
          },
        },
        {
          $group: {
            _id: { day: '$_id.day', binType: '$binType' },
            totalWeight: { $sum: '$latestWeight' },
          },
        },
        { $sort: { '_id.day': 1 } },
        {
          $group: {
            _id: '$_id.day',
            values: { $push: { binType: '$_id.binType', weight: '$totalWeight' } },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            time: '$_id',
            _id: 0,
            values: 1,
          },
        },
      ];
    }
    const pivotData = await Waste.aggregate(pipeline).allowDiskUse(true);
    if (pivotData.length < 2) {
      console.log('Insufficient data:', pivotData);
      return res
        .status(200)
        .json(new ApiResponse(200, pivotData, 'Insufficient data to render a line chart.'));
    }
    return res
      .status(200)
      .json(new ApiResponse(200, pivotData, 'Waste trend chart data retrieved successfully'));
  } catch (error) {
    console.error('Error in getWasteTrendChart:', error);
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
  // Use UTC-based date range helper for current period.
  const { startDate: currentStart, endDate: currentEnd } = getDateRangeFromFilterUTC(filter, now);
  const { previousStartDate, previousEndDate } = getPreviousDateRange(filter, now);
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
      { $group: { _id: null, totalWaste: { $sum: '$latestWeight' } } },
    ];
    const result = await Waste.aggregate(pipeline);
    return result[0]?.totalWaste || 0;
  };
  const thisPeriodWaste = await aggregateWasteForPeriod(currentStart, currentEnd);
  const previousPeriodWaste = await aggregateWasteForPeriod(previousStartDate, previousEndDate);
  let percentageChange = 0, trend = 'no change';
  if (previousPeriodWaste > 0) {
    percentageChange = ((thisPeriodWaste - previousPeriodWaste) / previousPeriodWaste) * 100;
    trend = thisPeriodWaste > previousPeriodWaste ? 'higher' : thisPeriodWaste < previousPeriodWaste ? 'lower' : 'equal';
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
  const { startDate, endDate } = getUTCDayRange(new Date(subDays(today, 6)));
  // Pipeline for last 7 days using UTC day boundaries.
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
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
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
  // Use UTC-based date range helper.
  const { startDate, endDate } = getDateRangeFromFilterUTC(filter, now);
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
  const { totalWaste: prevTotalWaste } = await aggregateWasteData(previousStartDate, previousEndDate, branchIds);
  const prevRecyclingWaste = await aggregateRecyclingWasteData(previousStartDate, previousEndDate, branchIds);
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
      .json(new ApiResponse(200, { leaderboard: [], period: periodLabel }, 'No branches found for the given filter'));
  }

  // Aggregation pipeline for leaderboard.
  const pipeline = [
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
      },
    },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: { bin: '$associateBin', day: '$day' },
        latestWaste: { $first: '$currentWeight' },
      },
    },
    {
      $group: {
        _id: '$_id.bin',
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
    pipeline.push({
      $group: {
        _id: '$branchDetails._id',
        branchName: { $first: '$branchDetails.officeName' },
        totalWaste: { $sum: '$cumulativeWaste' },
        landfillDiversion: {
          $sum: { $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0] },
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
    pipeline.push({
      $group: {
        _id: '$branchDetails.associatedCompany',
        totalWaste: { $sum: '$cumulativeWaste' },
        landfillDiversion: {
          $sum: { $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0] },
        },
      },
    });
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
  pipeline.push({ $sort: { diversionPercentage: -1 } });
  const leaderboard = await Waste.aggregate(pipeline);
  return res
    .status(200)
    .json(new ApiResponse(200, { leaderboard, period: periodLabel }, 'Leaderboard data fetched successfully'));
});

// Export all functions.
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
