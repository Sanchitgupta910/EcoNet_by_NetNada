import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { getUTCDayRange } from './SuperAdminAnalytics.controllers.js';
import { subDays } from 'date-fns';

/**
 * getLatestBinWeight:
 * Retrieves the latest waste record for a specific bin (today's data).
 */
const getLatestBinWeight = asyncHandler(async (req, res) => {
  const { binId } = req.query;
  if (!binId) throw new ApiError(400, 'binId is required');
  if (!mongoose.Types.ObjectId.isValid(binId)) throw new ApiError(400, 'Invalid binId format');

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
 * getBinStatus:
 * Retrieves real-time status for all bins in a branch.
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
 * getMinimalOverview:
 * Computes branch-level metrics for the employee dashboard.
 * Updated to use consistent aggregation (latest per bin per day) for trend and today's waste.
 */
const getMinimalOverview = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  const now = new Date();
  const { startDate, endDate } = getUTCDayRange(now);

  // Pipeline for computing today's waste for the branch (using only the latest reading per bin)
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
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: '$associateBin',
        latestWeight: { $first: '$currentWeight' },
      },
    },
    { $group: { _id: null, totalBranchWaste: { $sum: '$latestWeight' } } },
  ]).option({ allowDiskUse: true });
  const todayWaste = branchWasteAgg[0]?.totalBranchWaste || 0;

  // Retrieve the branch's company from the BranchAddress record.
  const branchRecord = await BranchAddress.findById(branchId).lean();
  if (!branchRecord) throw new ApiError(404, 'Branch not found');
  const compId = branchRecord.associatedCompany;

  // Find all branches belonging to that company.
  const companyBranches = await BranchAddress.find({
    associatedCompany: new mongoose.Types.ObjectId(compId),
  })
    .select('_id')
    .lean();
  const branchIds = companyBranches.map((b) => b._id);

  // Pipeline for computing total company waste (using only the latest reading per bin)
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
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: '$associateBin',
        latestWeight: { $first: '$currentWeight' },
      },
    },
    { $group: { _id: null, totalCompanyWaste: { $sum: '$latestWeight' } } },
  ]).option({ allowDiskUse: true });
  const totalCompanyWaste = companyWasteAgg[0]?.totalCompanyWaste || 0;

  // Calculate branch contribution as percentage.
  const branchContribution = totalCompanyWaste
    ? Math.round((todayWaste / totalCompanyWaste) * 100)
    : 0;

  // Optionally, you can also pass trendData etc. as needed.
  const overview = { todayWaste, branchContribution };

  return res
    .status(200)
    .json(new ApiResponse(200, overview, 'Minimal overview data fetched successfully'));
});

/**
 * getWasteLast7Days:
 * Retrieves waste data for the last 7 days using the latest reading per bin per day.
 */
const getWasteLast7Days = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  const today = new Date();
  const startDate = getUTCDayRange(new Date(subDays(today, 6))).startDate;
  const endDate = getUTCDayRange(today).endDate;
  const pipeline = [
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    { $sort: { associateBin: 1, createdAt: -1 } },
    {
      $group: {
        _id: {
          bin: '$associateBin',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
        weight: { $first: '$currentWeight' },
      },
    },
    {
      $lookup: {
        from: 'dustbins',
        localField: '_id.bin',
        foreignField: '_id',
        as: 'binData',
      },
    },
    { $unwind: '$binData' },
    { $match: { 'binData.branchAddress': new mongoose.Types.ObjectId(branchId) } },
    {
      $group: {
        _id: '$_id.bin',
        binName: { $first: '$binData.dustbinType' },
        data: { $push: { date: '$_id.date', weight: '$weight' } },
      },
    },
    { $sort: { binName: 1 } },
  ];
  const wasteData = await Waste.aggregate(pipeline, { allowDiskUse: true });
  return res
    .status(200)
    .json(new ApiResponse(200, wasteData, 'Waste data for last 7 days retrieved successfully'));
});

/**
 * getWasteTrendComparison:
 * Compares total waste of this week vs last week for a branch,
 * logs debug information to console.
 */
const getWasteTrendComparison = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  console.log('🔍 getWasteTrendComparison called with branchId:', branchId);
  if (!branchId) throw new ApiError(400, 'branchId is required');
  if (!mongoose.Types.ObjectId.isValid(branchId))
    throw new ApiError(400, 'Invalid branchId format');

  const today = new Date();
  const { startDate: thisWeekStart } = getUTCDayRange(subDays(today, 6));
  const { endDate: thisWeekEnd } = getUTCDayRange(today);
  const { startDate: lastWeekStart } = getUTCDayRange(subDays(today, 13));
  const { endDate: lastWeekEnd } = getUTCDayRange(subDays(today, 7));
  console.log('📆 Date Ranges:', { thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd });

  const getPeriodTotal = async (startDate, endDate) => {
    const agg = await Waste.aggregate([
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
          _id: '$associateBin',
          latestWeight: { $first: '$currentWeight' },
        },
      },
      { $group: { _id: null, total: { $sum: '$latestWeight' } } },
    ]).option({ allowDiskUse: true });
    return agg[0]?.total || 0;
  };

  const thisWeekTotal = await getPeriodTotal(thisWeekStart, thisWeekEnd);
  const lastWeekTotal = await getPeriodTotal(lastWeekStart, lastWeekEnd);
  console.log('🔢 Totals:', { thisWeekTotal, lastWeekTotal });

  let percentChange = 0;
  if (lastWeekTotal > 0) {
    const rawChange = ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100;
    percentChange = parseFloat(rawChange.toFixed(2));
  }
  console.log('📈 percentChange:', percentChange);

  const trend = percentChange > 0 ? 'higher' : percentChange < 0 ? 'lower' : 'equal';
  const message = `This week total waste collection (${Math.abs(thisWeekTotal).toFixed(
    2,
  )} KG) is ${Math.abs(percentChange).toFixed(
    2,
  )}% ${trend} compared to last week (${lastWeekTotal} KG)`;
  console.log('📣 message:', message);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { thisWeekTotal, lastWeekTotal, percentChange, trend, message },
        'Waste trend comparison fetched successfully',
      ),
    );
});

/**
 * getDiversionRate:
 * Retrieves today’s diversion % and the change vs. yesterday for a branch.
 */
const getDiversionRate = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) throw new ApiError(400, 'branchId is required');
  if (!mongoose.Types.ObjectId.isValid(branchId))
    throw new ApiError(400, 'Invalid branchId format');

  // helper to run one-day pipeline
  const oneDay = async (startDate, endDate) => {
    const recs = await Waste.aggregate([
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
          _id: '$associateBin',
          latestWeight: { $first: '$currentWeight' },
          binType: { $first: '$binData.dustbinType' },
        },
      },
    ]).option({ allowDiskUse: true });

    let total = 0,
      diverted = 0;
    for (const { latestWeight, binType } of recs) {
      total += latestWeight;
      if (binType !== 'General Waste') diverted += latestWeight;
    }
    const pct = total > 0 ? Number(((diverted / total) * 100).toFixed(2)) : 0;
    return pct;
  };

  // today
  const now = new Date();
  const { startDate: todayStart, endDate: todayEnd } = getUTCDayRange(now);
  const todayPct = await oneDay(todayStart, todayEnd);

  // yesterday
  const yesterday = subDays(now, 1);
  const { startDate: yStart, endDate: yEnd } = getUTCDayRange(yesterday);
  const yesterdayPct = await oneDay(yStart, yEnd);

  const trendValue = Number((todayPct - yesterdayPct).toFixed(2));

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { diversionPercentage: todayPct, trendValue },
        'Branch diversion rate fetched successfully',
      ),
    );
});

export {
  getLatestBinWeight,
  getBinStatus,
  getMinimalOverview,
  getWasteLast7Days,
  getWasteTrendComparison,
  getDiversionRate,
};
