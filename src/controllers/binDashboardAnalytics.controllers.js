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
 * initRealTimeUpdates:
 * Initializes a MongoDB change stream on the Waste collection and emits a real-time
 * Socket.io event whenever a new waste record is inserted.
 *
 * To use this, pass in your Socket.io server instance (io) from your main server file.
 */
const initRealTimeUpdates = (io) => {
  // Create a change stream on the Waste collection
  const changeStream = Waste.watch();

  changeStream.on('change', (change) => {
    // We are interested in new records, i.e. when a document is inserted.
    if (change.operationType === 'insert') {
      // Emit a Socket.io event with the new record details.
      io.emit('newWasteEntry', change.fullDocument);
      // Optionally, you could perform additional logic such as updating other
      // collections or broadcasting a summary update for the dashboard.
      console.log('New waste entry detected and emitted via Socket.io');
    }
  });

  changeStream.on('error', (error) => {
    console.error('Error in Waste change stream: ', error);
  });
};

export {
  getLatestBinWeight,
  getBinStatus,
  getMinimalOverview,
  getWasteLast7Days,
  initRealTimeUpdates,
};
