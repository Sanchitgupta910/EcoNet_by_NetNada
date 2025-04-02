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
 * Returns start and end dates based on filter ("today", "thisWeek", "thisMonth", "lastMonth")
 */
const getDateRangeFromFilterUTC = (filter, now = new Date()) => {
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
const getPreviousDateRange = (filter, now = new Date()) => {
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

//--------------------------------------------------------------------------------------outdated admin overview---------
// /**
//  * getAdminOverview:
//  * Computes admin-level metrics.
//  */
// const getAdminOverview = asyncHandler(async (req, res) => {
//   const { companyId, orgUnitId, filter } = req.query;
//   const now = new Date();
//   const { startDate, endDate } = getDateRangeFromFilterUTC(filter, now);
//   let { previousStartDate, previousEndDate } = getPreviousDateRange(filter, now);

//   // For the "lastMonth" filter, override the previous period to use the current month's range.
//   // This makes the comparison "last month" (current period) compared to "this month" (previous period).
//   if (filter === 'lastMonth') {
//     previousStartDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
//     previousEndDate = now;
//     console.log(
//       `Overriding previous period for 'lastMonth': ${previousStartDate.toISOString()} to ${previousEndDate.toISOString()}`,
//     );
//   }

//   let branchFilter = { isdeleted: false };
//   if (companyId) branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
//   if (orgUnitId) {
//     let orgUnit = await OrgUnit.findById(orgUnitId).lean();
//     if (!orgUnit) {
//       const branch = await BranchAddress.findById(orgUnitId).lean();
//       if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
//       orgUnit = { _id: branch._id, type: 'Branch', branchAddress: branch._id };
//     }
//     switch (orgUnit.type) {
//       case 'Branch':
//         if (orgUnit.branchAddress)
//           branchFilter._id = new mongoose.Types.ObjectId(orgUnit.branchAddress);
//         else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
//         break;
//       case 'City':
//         branchFilter.city = orgUnit.name;
//         break;
//       case 'Country':
//         branchFilter.country = orgUnit.name;
//         break;
//       case 'Region':
//       case 'State':
//         branchFilter.subdivision = orgUnit.name;
//         break;
//       default:
//         break;
//     }
//   }

//   const branches = await BranchAddress.find(branchFilter).select('_id').lean();
//   const branchIds = branches.map((b) => b._id);

//   if (branchIds.length === 0) {
//     const overviewData = {
//       totalBins: 0,
//       totalWaste: 0,
//       landfillDiversionPercentage: 0,
//       totalWasteTrend: 0,
//       landfillDiversionTrend: 0,
//     };
//     return res
//       .status(200)
//       .json(new ApiResponse(200, overviewData, 'No branches found for the given filter'));
//   }

//   // Compute total bins.
//   const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

//   // Get latest waste per bin for current period.
//   const latestRecords = await getLatestWastePerBin(startDate, endDate, branchIds);
//   const totalWaste = latestRecords.reduce((sum, record) => sum + record.latestWeight, 0);
//   const landfillDiversion = latestRecords.reduce(
//     (sum, record) => (record.dustbinType !== 'General Waste' ? sum + record.latestWeight : sum),
//     0,
//   );
//   const currentDiversionPercentage =
//     totalWaste > 0 ? Number(((landfillDiversion / totalWaste) * 100).toFixed(2)) : 0;

//   // Get previous period records.
//   const prevRecords = await getLatestWastePerBin(previousStartDate, previousEndDate, branchIds);
//   const prevTotalWaste = prevRecords.reduce((sum, record) => sum + record.latestWeight, 0);
//   const prevLandfillDiversion = prevRecords.reduce(
//     (sum, record) => (record.dustbinType !== 'General Waste' ? sum + record.latestWeight : sum),
//     0,
//   );
//   const totalWasteTrend =
//     prevTotalWaste > 0
//       ? Number((((totalWaste - prevTotalWaste) / prevTotalWaste) * 100).toFixed(2))
//       : 0;
//   const landfillDiversionTrend =
//     prevLandfillDiversion > 0
//       ? Number(
//           (((landfillDiversion - prevLandfillDiversion) / prevLandfillDiversion) * 100).toFixed(2),
//         )
//       : 0;

//   const overviewData = {
//     totalBins,
//     totalWaste,
//     landfillDiversionPercentage: currentDiversionPercentage,
//     totalWasteTrend,
//     landfillDiversionTrend,
//   };

//   return res
//     .status(200)
//     .json(new ApiResponse(200, overviewData, 'Admin overview data fetched successfully'));
// });

//--------------------------------------------------------------------------------------new  admin overview---------------------

/**
 * getAdminOverview
 * GET /api/v1/analytics/adminOverview
 *
 * Returns aggregated admin metrics:
 *  - totalBins: Count of bins (from Dustbin collection) for branches under the filter.
 *  - totalWaste: Sum of the latest waste readings per bin (for current period).
 *  - landfillDiversionPercentage: (landfillDiversion / totalWaste) * 100.
 *  - totalWasteTrend & landfillDiversionTrend: Percentage changes from previous period.
 *
 * For non-SuperAdmin users, the branches are filtered based on the logged-in user's OrgUnit:
 *   - Country admin: only branches where BranchAddress.country equals OrgUnit.name.
 *   - City admin: only branches where BranchAddress.city equals OrgUnit.name.
 *   - Region/State admin: only branches where BranchAddress.subdivision equals OrgUnit.name.
 *   - Branch admin: only that branch (using OrgUnit.branchAddress).
 * SuperAdmin users are not further restricted.
 */
const getAdminOverview = asyncHandler(async (req, res) => {
  const { companyId, orgUnitId, filter } = req.query;
  const now = new Date();
  const { startDate, endDate } = getDateRangeFromFilterUTC(filter, now);
  const { previousStartDate, previousEndDate } = getPreviousDateRange(filter, now);

  // --- Build Branch Filter ---
  let branchFilter = { isdeleted: false };

  if (req.user && req.user.role === 'SuperAdmin') {
    if (companyId) {
      if (!mongoose.Types.ObjectId.isValid(companyId))
        throw new ApiError(400, 'Invalid companyId format');
      branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
    }
  } else {
    branchFilter.associatedCompany = req.user.company;
    let filterOrgUnit;
    if (orgUnitId) {
      filterOrgUnit = await OrgUnit.findById(orgUnitId).lean();
    } else {
      filterOrgUnit = req.user.OrgUnit;
    }
    if (filterOrgUnit && filterOrgUnit.type) {
      if (filterOrgUnit.type === 'Branch' && filterOrgUnit.branchAddress) {
        branchFilter._id = new mongoose.Types.ObjectId(filterOrgUnit.branchAddress);
      } else if (filterOrgUnit.type === 'City' && filterOrgUnit.name) {
        branchFilter.city = filterOrgUnit.name;
      } else if (filterOrgUnit.type === 'Country' && filterOrgUnit.name) {
        branchFilter.country = filterOrgUnit.name;
      } else if (
        (filterOrgUnit.type === 'Region' || filterOrgUnit.type === 'State') &&
        filterOrgUnit.name
      ) {
        branchFilter.subdivision = filterOrgUnit.name;
      }
    }
  }

  // Retrieve branch IDs based on the filter.
  const branches = await BranchAddress.find(branchFilter).select('_id').lean();
  const branchIds = branches.map((b) => b._id);
  if (!branchIds.length) {
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

  // --- Compute Total Bins ---
  // Count bins from the Dustbin collection for branches in branchIds.
  const totalBins = await Dustbin.countDocuments({ branchAddress: { $in: branchIds } });

  // --- Aggregate Waste Data for Current Period ---
  const latestRecords = await Waste.aggregate([
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
        _id: {
          associateBin: '$associateBin',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
        latestWeight: { $first: '$currentWeight' },
        dustbinType: { $first: '$binData.dustbinType' },
      },
    },
  ]).option({ allowDiskUse: true });

  const totalWaste = latestRecords.reduce((sum, record) => sum + record.latestWeight, 0);
  const landfillDiversion = latestRecords.reduce(
    (sum, record) => (record.dustbinType !== 'General Waste' ? sum + record.latestWeight : sum),
    0,
  );
  const currentDiversionPercentage =
    totalWaste > 0 ? Number(((landfillDiversion / totalWaste) * 100).toFixed(2)) : 0;

  // --- Aggregate Waste Data for Previous Period ---
  const prevRecords = await Waste.aggregate([
    { $match: { createdAt: { $gte: previousStartDate, $lte: previousEndDate } } },
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
        _id: {
          associateBin: '$associateBin',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
        latestWeight: { $first: '$currentWeight' },
        dustbinType: { $first: '$binData.dustbinType' },
      },
    },
  ]).option({ allowDiskUse: true });

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
// const getLeaderboardData = asyncHandler(async (req, res) => {
//   const { companyId, orgUnitId } = req.query;
//   const now = new Date();
//   // Use the same period logic as before.
//   const { startDate, endDate, periodLabel } = getDateRangeForLeaderboard(now);

//   // Build branch filter based on companyId and optionally orgUnitId.
//   let branchFilter = { isdeleted: false };
//   if (companyId) {
//     branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
//   }
//   // If an organization unit is selected, assume its ID corresponds to a branch.
//   if (orgUnitId) {
//     branchFilter._id = new mongoose.Types.ObjectId(orgUnitId);
//   }

//   // Retrieve branches matching the filter.
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

//   // Build the aggregation pipeline.
//   let pipeline = [
//     // Filter waste records over the leaderboard period.
//     { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
//     // Add a 'day' field in UTC (formatted as YYYY-MM-DD).
//     {
//       $addFields: {
//         day: {
//           $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
//         },
//       },
//     },
//     // Sort so that the latest record per bin appears first.
//     { $sort: { associateBin: 1, createdAt: -1 } },
//     // Group by bin and day, picking the latest reading per bin per day.
//     {
//       $group: {
//         _id: { bin: '$associateBin', day: '$day' },
//         latestWaste: { $first: '$currentWeight' },
//       },
//     },
//     // Sum the daily latest readings per bin.
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
//     // Only include bins from the branches we care about.
//     { $match: { 'binDetails.branchAddress': { $in: branchIds } } },
//     // Lookup branch details for grouping.
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

//   // If an organization unit is selected, group at the branch level.
//   if (orgUnitId) {
//     pipeline.push(
//       {
//         $group: {
//           _id: '$branchDetails._id',
//           branchName: { $first: '$branchDetails.officeName' },
//           totalWaste: { $sum: '$cumulativeWaste' },
//           landfillDiversion: {
//             $sum: {
//               $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0],
//             },
//           },
//         },
//       },
//       {
//         $project: {
//           totalWaste: 1,
//           diversionPercentage: {
//             $cond: [
//               { $gt: ['$totalWaste', 0] },
//               { $multiply: [{ $divide: ['$landfillDiversion', '$totalWaste'] }, 100] },
//               0,
//             ],
//           },
//           name: '$branchName',
//         },
//       },
//     );
//   } else {
//     // Otherwise, group at the organization level.
//     pipeline.push(
//       {
//         $group: {
//           _id: '$branchDetails.associatedCompany',
//           totalWaste: { $sum: '$cumulativeWaste' },
//           landfillDiversion: {
//             $sum: {
//               $cond: [{ $ne: ['$binDetails.dustbinType', 'General Waste'] }, '$cumulativeWaste', 0],
//             },
//           },
//         },
//       },
//       // Join with companies collection to retrieve company names.
//       {
//         $lookup: {
//           from: 'companies',
//           localField: '_id',
//           foreignField: '_id',
//           as: 'companyDetails',
//         },
//       },
//       { $unwind: '$companyDetails' },
//       {
//         $project: {
//           totalWaste: 1,
//           diversionPercentage: {
//             $cond: [
//               { $gt: ['$totalWaste', 0] },
//               { $multiply: [{ $divide: ['$landfillDiversion', '$totalWaste'] }, 100] },
//               0,
//             ],
//           },
//           name: '$companyDetails.CompanyName',
//         },
//       },
//     );
//   }

//   // Sort the results in descending order by diversion percentage.
//   pipeline.push({ $sort: { diversionPercentage: -1 } });

//   const leaderboard = await Waste.aggregate(pipeline).allowDiskUse(true);
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

// const getDateRangeForLeaderboard = (now = new Date()) => {
//   let periodLabel = 'This Month';
//   let startDate, endDate;
//   if (now.getUTCDate() <= 7) {
//     // Use last month's period to ensure sufficient data.
//     const lastMonth = subMonths(now, 1);
//     startDate = startOfMonth(lastMonth);
//     endDate = endOfMonth(lastMonth);
//     periodLabel = 'Last Month';
//   } else {
//     startDate = startOfMonth(now);
//     endDate = endOfMonth(now);
//   }
//   return { startDate, endDate, periodLabel };
// };

//------------------------------------------------------------------------leaderboard data new code

/**
 * getDateRangeForLeaderboard:
 * Returns the aggregation period.
 * If today's UTC day is ≤ 7, uses last month's period; otherwise, uses the current month's period.
 */
const getDateRangeForLeaderboard = (now = new Date()) => {
  let periodLabel = 'This Month';
  let startDate, endDate;
  if (now.getUTCDate() <= 7) {
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
 * GET /api/v1/analytics/leaderboard
 *
 * Returns leaderboard data filtered based on the logged-in user's OrgUnit.
 * - For SuperAdmin, filtering is based solely on query parameters.
 * - For non-SuperAdmin, branches are filtered as follows:
 *    • Country admin: only branches where BranchAddress.country equals OrgUnit.name.
 *    • City admin: only branches where BranchAddress.city equals OrgUnit.name.
 *    • Region/State admin: only branches where BranchAddress.subdivision equals OrgUnit.name.
 *    • Branch admin: only the branch indicated by OrgUnit.branchAddress.
 */
const getLeaderboardData = asyncHandler(async (req, res) => {
  // Ensure that authentication middleware (verifyJWT) has set req.user.
  const loggedInUser = req.user;
  if (!loggedInUser) {
    console.error('User not authenticated in leaderboard controller');
    throw new ApiError(401, 'User not authenticated');
  }

  console.log('Logged User OrgUnit:', loggedInUser.OrgUnit);

  const { companyId } = req.query;
  const now = new Date();
  const { startDate, endDate, periodLabel } = getDateRangeForLeaderboard(now);

  // Build the branch filter.
  let branchFilter = { isdeleted: false };

  if (loggedInUser.role === 'SuperAdmin') {
    if (companyId) {
      if (!mongoose.Types.ObjectId.isValid(companyId))
        throw new ApiError(400, 'Invalid companyId format');
      branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
    }
    // No further filtering for SuperAdmin.
  } else {
    // For non-SuperAdmin, restrict to the user's company.
    branchFilter.associatedCompany = loggedInUser.company;
    const userOrgUnit = loggedInUser.OrgUnit;
    if (userOrgUnit && userOrgUnit.type) {
      if (userOrgUnit.type === 'Branch' && userOrgUnit.branchAddress) {
        branchFilter._id = new mongoose.Types.ObjectId(userOrgUnit.branchAddress);
      } else if (userOrgUnit.type === 'City' && userOrgUnit.name) {
        branchFilter.city = userOrgUnit.name;
      } else if (userOrgUnit.type === 'Country' && userOrgUnit.name) {
        branchFilter.country = userOrgUnit.name;
      } else if (
        (userOrgUnit.type === 'Region' || userOrgUnit.type === 'State') &&
        userOrgUnit.name
      ) {
        branchFilter.subdivision = userOrgUnit.name;
      }
    }
  }

  console.log('Branch Filter:', branchFilter);

  const branches = await BranchAddress.find(branchFilter)
    .select('_id officeName associatedCompany')
    .lean();
  const branchIds = branches.map((b) => b._id);
  if (!branchIds.length) {
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

  // Build aggregation pipeline.
  let pipeline = [
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

//------------------------------------------------------ outdated chart controllers----------------------------------------------

// const getWasteTrendChart = asyncHandler(async (req, res) => {
//   const { branchId, companyId, orgUnitId, filter, zoomDate } = req.query;

//   // Build branchIds using branch, company or org unit filters.
//   let branchIds = [];
//   if (branchId) {
//     if (!mongoose.Types.ObjectId.isValid(branchId))
//       throw new ApiError(400, 'Invalid branchId format');
//     branchIds = [new mongoose.Types.ObjectId(branchId)];
//   } else if (companyId) {
//     if (!mongoose.Types.ObjectId.isValid(companyId))
//       throw new ApiError(400, 'Invalid companyId format');
//     const branches = await BranchAddress.find({
//       associatedCompany: new mongoose.Types.ObjectId(companyId),
//       isdeleted: false,
//     })
//       .select('_id')
//       .lean();
//     if (!branches.length) throw new ApiError(404, 'No branches found for the given company');
//     branchIds = branches.map((b) => b._id);
//   } else if (orgUnitId) {
//     if (!mongoose.Types.ObjectId.isValid(orgUnitId))
//       throw new ApiError(400, 'Invalid orgUnitId format');
//     // Look up the org unit.
//     let orgUnit = await OrgUnit.findById(orgUnitId).lean();
//     if (!orgUnit) {
//       // Fall back to branch lookup if org unit not found.
//       const branch = await BranchAddress.findById(orgUnitId).lean();
//       if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
//       orgUnit = {
//         _id: branch._id,
//         type: 'Branch',
//         branchAddress: branch._id,
//         name: branch.officeName,
//       };
//     }
//     switch (orgUnit.type) {
//       case 'Branch':
//         if (orgUnit.branchAddress) branchIds = [new mongoose.Types.ObjectId(orgUnit.branchAddress)];
//         else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
//         break;
//       case 'City': {
//         const branchesInCity = await BranchAddress.find({
//           city: orgUnit.name,
//           isdeleted: false,
//         })
//           .select('_id')
//           .lean();
//         branchIds = branchesInCity.map((b) => b._id);
//         break;
//       }
//       case 'Country': {
//         const branchesInCountry = await BranchAddress.find({
//           country: orgUnit.name,
//           isdeleted: false,
//         })
//           .select('_id')
//           .lean();
//         branchIds = branchesInCountry.map((b) => b._id);
//         break;
//       }
//       case 'Region':
//       case 'State': {
//         const branchesInSubdivision = await BranchAddress.find({
//           subdivision: orgUnit.name,
//           isdeleted: false,
//         })
//           .select('_id')
//           .lean();
//         branchIds = branchesInSubdivision.map((b) => b._id);
//         break;
//       }
//       default: {
//         const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
//         branchIds = allBranches.map((b) => b._id);
//       }
//     }
//   } else {
//     const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
//     branchIds = allBranches.map((b) => b._id);
//   }
//   if (!branchIds.length) {
//     return res.status(200).json(new ApiResponse(200, [], 'No branches found for the given filter'));
//   }

//   // Determine date range and aggregation granularity.
//   const now = new Date();
//   let startDateVal, endDateVal;
//   let isHourly = false;
//   if (filter === 'today' || zoomDate) {
//     if (zoomDate) {
//       const zDate = new Date(zoomDate);
//       if (isNaN(zDate)) throw new ApiError(400, 'Invalid zoomDate format');
//       ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(zDate));
//     } else {
//       ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(now));
//     }
//     isHourly = true;
//   } else {
//     ({ startDate: startDateVal, endDate: endDateVal } = getDateRangeFromFilterUTC(filter, now));
//   }

//   // Build aggregation pipeline.
//   const pipeline = [
//     { $match: { createdAt: { $gte: startDateVal, $lte: endDateVal } } },
//     { $sort: { associateBin: 1, createdAt: -1 } },
//     {
//       $lookup: {
//         from: 'dustbins',
//         let: { binId: '$associateBin' },
//         pipeline: [
//           {
//             $match: {
//               $expr: {
//                 $and: [{ $eq: ['$_id', '$$binId'] }, { $in: ['$branchAddress', branchIds] }],
//               },
//             },
//           },
//           { $project: { dustbinType: 1 } },
//         ],
//         as: 'binDetails',
//       },
//     },
//     { $match: { binDetails: { $ne: [] } } },
//   ];

//   if (isHourly) {
//     pipeline.push({ $addFields: { hour: { $hour: '$createdAt' } } });
//     pipeline.push({
//       $group: {
//         _id: {
//           bin: '$associateBin',
//           hour: '$hour',
//           binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
//         },
//         latestWeight: { $first: '$currentWeight' },
//       },
//     });
//     pipeline.push({
//       $group: {
//         _id: { hour: '$_id.hour', binType: '$_id.binType' },
//         totalWeight: { $sum: '$latestWeight' },
//       },
//     });
//     pipeline.push({
//       $group: {
//         _id: '$_id.hour',
//         bins: { $push: { k: '$_id.binType', v: '$totalWeight' } },
//       },
//     });
//     pipeline.push({
//       $project: {
//         time: '$_id',
//         _id: 0,
//         data: { $arrayToObject: '$bins' },
//       },
//     });
//     pipeline.push({ $sort: { time: 1 } });
//   } else {
//     pipeline.push({
//       $addFields: {
//         day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
//       },
//     });
//     pipeline.push({ $sort: { associateBin: 1, createdAt: -1 } });
//     pipeline.push({
//       $group: {
//         _id: {
//           bin: '$associateBin',
//           day: '$day',
//           binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
//         },
//         latestWeight: { $first: '$currentWeight' },
//       },
//     });
//     pipeline.push({
//       $group: {
//         _id: { day: '$_id.day', binType: '$_id.binType' },
//         totalWeight: { $sum: '$latestWeight' },
//       },
//     });
//     pipeline.push({
//       $group: {
//         _id: '$_id.day',
//         bins: { $push: { k: '$_id.binType', v: '$totalWeight' } },
//       },
//     });
//     pipeline.push({
//       $project: {
//         time: '$_id',
//         _id: 0,
//         data: { $arrayToObject: '$bins' },
//       },
//     });
//     pipeline.push({ $sort: { time: 1 } });
//   }

//   const result = await Waste.aggregate(pipeline, { allowDiskUse: true });
//   return res
//     .status(200)
//     .json(new ApiResponse(200, result, 'Waste trend chart data retrieved successfully'));
// });

// const getWasteDispositionRates = asyncHandler(async (req, res) => {
//   const { branchId, companyId, orgUnitId, filter } = req.query;

//   // Build branchIds using branch, company, or org unit filters.
//   let branchIds = [];
//   if (branchId) {
//     if (!mongoose.Types.ObjectId.isValid(branchId))
//       throw new ApiError(400, 'Invalid branchId format');
//     branchIds = [new mongoose.Types.ObjectId(branchId)];
//   } else if (companyId) {
//     if (!mongoose.Types.ObjectId.isValid(companyId))
//       throw new ApiError(400, 'Invalid companyId format');
//     const branches = await BranchAddress.find({
//       associatedCompany: new mongoose.Types.ObjectId(companyId),
//       isdeleted: false,
//     })
//       .select('_id')
//       .lean();
//     if (!branches.length) throw new ApiError(404, 'No branches found for the given company');
//     branchIds = branches.map((b) => b._id);
//   } else if (orgUnitId) {
//     if (!mongoose.Types.ObjectId.isValid(orgUnitId))
//       throw new ApiError(400, 'Invalid orgUnitId format');
//     let orgUnit = await OrgUnit.findById(orgUnitId).lean();
//     if (!orgUnit) {
//       const branch = await BranchAddress.findById(orgUnitId).lean();
//       if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
//       orgUnit = {
//         _id: branch._id,
//         type: 'Branch',
//         branchAddress: branch._id,
//         name: branch.officeName,
//       };
//     }
//     switch (orgUnit.type) {
//       case 'Branch':
//         if (orgUnit.branchAddress) branchIds = [new mongoose.Types.ObjectId(orgUnit.branchAddress)];
//         else throw new ApiError(400, 'Branch OrgUnit missing branchAddress field');
//         break;
//       case 'City': {
//         const branchesInCity = await BranchAddress.find({
//           city: orgUnit.name,
//           isdeleted: false,
//         })
//           .select('_id')
//           .lean();
//         branchIds = branchesInCity.map((b) => b._id);
//         break;
//       }
//       case 'Country': {
//         const branchesInCountry = await BranchAddress.find({
//           country: orgUnit.name,
//           isdeleted: false,
//         })
//           .select('_id')
//           .lean();
//         branchIds = branchesInCountry.map((b) => b._id);
//         break;
//       }
//       case 'Region':
//       case 'State': {
//         const branchesInSubdivision = await BranchAddress.find({
//           subdivision: orgUnit.name,
//           isdeleted: false,
//         })
//           .select('_id')
//           .lean();
//         branchIds = branchesInSubdivision.map((b) => b._id);
//         break;
//       }
//       default: {
//         const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
//         branchIds = allBranches.map((b) => b._id);
//       }
//     }
//   } else {
//     const allBranches = await BranchAddress.find({ isdeleted: false }).select('_id').lean();
//     branchIds = allBranches.map((b) => b._id);
//   }
//   if (!branchIds.length) {
//     return res.status(200).json(new ApiResponse(200, [], 'No branches found for the given filter'));
//   }

//   // Determine date range and aggregation granularity.
//   // When filter is "today", aggregate hourly; otherwise, daily.
//   const now = new Date();
//   let startDateVal, endDateVal;
//   let isHourly = false;
//   if (filter === 'today') {
//     ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(now));
//     isHourly = true;
//   } else {
//     ({ startDate: startDateVal, endDate: endDateVal } = getDateRangeFromFilterUTC(filter, now));
//   }

//   // Build pipeline.
//   const pipeline = [
//     { $match: { createdAt: { $gte: startDateVal, $lte: endDateVal } } },
//     { $sort: { associateBin: 1, createdAt: -1 } },
//     {
//       $lookup: {
//         from: 'dustbins',
//         let: { binId: '$associateBin' },
//         pipeline: [
//           {
//             $match: {
//               $expr: {
//                 $and: [{ $eq: ['$_id', '$$binId'] }, { $in: ['$branchAddress', branchIds] }],
//               },
//             },
//           },
//           { $project: { dustbinType: 1 } },
//         ],
//         as: 'binDetails',
//       },
//     },
//     { $match: { binDetails: { $ne: [] } } },
//   ];

//   if (isHourly) {
//     pipeline.push({ $addFields: { hour: { $hour: '$createdAt' } } });
//     pipeline.push({
//       $group: {
//         _id: {
//           bin: '$associateBin',
//           hour: '$hour',
//           binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
//         },
//         latestWeight: { $first: '$currentWeight' },
//       },
//     });
//     pipeline.push({
//       $addFields: {
//         landfillWaste: {
//           $cond: [{ $eq: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
//         },
//         divertedWaste: {
//           $cond: [{ $ne: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
//         },
//       },
//     });
//     pipeline.push({
//       $group: {
//         _id: '$_id.hour',
//         totalLandfill: { $sum: '$landfillWaste' },
//         totalDiverted: { $sum: '$divertedWaste' },
//       },
//     });
//     pipeline.push({
//       $project: {
//         time: '$_id',
//         _id: 0,
//         landfillWaste: '$totalLandfill',
//         divertedWaste: '$totalDiverted',
//       },
//     });
//     pipeline.push({ $sort: { time: 1 } });
//   } else {
//     pipeline.push({
//       $addFields: {
//         day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
//       },
//     });
//     pipeline.push({ $sort: { associateBin: 1, createdAt: -1 } });
//     pipeline.push({
//       $group: {
//         _id: {
//           bin: '$associateBin',
//           day: '$day',
//           binType: { $arrayElemAt: ['$binDetails.dustbinType', 0] },
//         },
//         latestWeight: { $first: '$currentWeight' },
//       },
//     });
//     pipeline.push({
//       $addFields: {
//         landfillWaste: {
//           $cond: [{ $eq: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
//         },
//         divertedWaste: {
//           $cond: [{ $ne: ['$_id.binType', 'General Waste'] }, '$latestWeight', 0],
//         },
//       },
//     });
//     pipeline.push({
//       $group: {
//         _id: '$_id.day',
//         totalLandfill: { $sum: '$landfillWaste' },
//         totalDiverted: { $sum: '$divertedWaste' },
//       },
//     });
//     pipeline.push({
//       $project: {
//         time: '$_id',
//         _id: 0,
//         landfillWaste: '$totalLandfill',
//         divertedWaste: '$totalDiverted',
//       },
//     });
//     pipeline.push({ $sort: { time: 1 } });
//   }

//   const result = await Waste.aggregate(pipeline, { allowDiskUse: true });
//   return res
//     .status(200)
//     .json(new ApiResponse(200, result, 'Waste disposition rates retrieved successfully'));
// });

//---------------------------------------------------------------new chart controllers------------------------------------------------------
/**
 * getWasteTrendChart
 * GET /api/v1/analytics/wasteTrendChart
 *
 * Returns time-series waste data for the line chart.
 * - When filter is "today": aggregates data hourly.
 * - Otherwise: aggregates data daily.
 *
 * Data is pivoted by bin type so that each record has:
 *   { time: <hour or date>, data: { <binType>: <totalWeight>, ... } }
 *
 * For non-SuperAdmin users, if no explicit branch/company/orgUnit filter is provided,
 * the data is restricted based on the logged-in user's OrgUnit.
 */
const getWasteTrendChart = asyncHandler(async (req, res) => {
  const { branchId, companyId, orgUnitId, filter, zoomDate } = req.query;

  // Initialize branch filter object for querying BranchAddress.
  let branchFilter = { isdeleted: false };

  // If explicit branchId or companyId or orgUnitId is provided, use those.
  if (branchId) {
    if (!mongoose.Types.ObjectId.isValid(branchId))
      throw new ApiError(400, 'Invalid branchId format');
    branchFilter._id = new mongoose.Types.ObjectId(branchId);
  } else if (companyId) {
    if (!mongoose.Types.ObjectId.isValid(companyId))
      throw new ApiError(400, 'Invalid companyId format');
    branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
  } else if (orgUnitId) {
    // For org unit provided explicitly, we look up the OrgUnit and apply filters.
    if (!mongoose.Types.ObjectId.isValid(orgUnitId))
      throw new ApiError(400, 'Invalid orgUnitId format');
    let orgUnit = await OrgUnit.findById(orgUnitId).lean();
    if (!orgUnit) {
      // Fallback: try to find as BranchAddress.
      const branch = await BranchAddress.findById(orgUnitId).lean();
      if (!branch) throw new ApiError(404, 'OrgUnit or BranchAddress not found');
      orgUnit = {
        _id: branch._id,
        type: 'Branch',
        branchAddress: branch._id,
        name: branch.officeName,
      };
    }
    // Apply filter based on OrgUnit type.
    if (orgUnit.type === 'Branch' && orgUnit.branchAddress) {
      branchFilter._id = new mongoose.Types.ObjectId(orgUnit.branchAddress);
    } else if (orgUnit.type === 'City' && orgUnit.name) {
      branchFilter.city = orgUnit.name;
    } else if (orgUnit.type === 'Country' && orgUnit.name) {
      branchFilter.country = orgUnit.name;
    } else if ((orgUnit.type === 'Region' || orgUnit.type === 'State') && orgUnit.name) {
      branchFilter.subdivision = orgUnit.name;
    }
  } else {
    // If no explicit filter is provided, and the user is not SuperAdmin, apply filtering based on logged-in user.
    if (req.user && req.user.role !== 'SuperAdmin' && req.user.OrgUnit) {
      const userOrgUnit = req.user.OrgUnit;
      // Restrict to the user's company.
      branchFilter.associatedCompany = req.user.company;
      if (userOrgUnit.type === 'Branch' && userOrgUnit.branchAddress) {
        branchFilter._id = new mongoose.Types.ObjectId(userOrgUnit.branchAddress);
      } else if (userOrgUnit.type === 'City' && userOrgUnit.name) {
        branchFilter.city = userOrgUnit.name;
      } else if (userOrgUnit.type === 'Country' && userOrgUnit.name) {
        branchFilter.country = userOrgUnit.name;
      } else if (
        (userOrgUnit.type === 'Region' || userOrgUnit.type === 'State') &&
        userOrgUnit.name
      ) {
        branchFilter.subdivision = userOrgUnit.name;
      }
    }
  }

  // Retrieve branches based on branchFilter.
  const branches = await BranchAddress.find(branchFilter).select('_id').lean();
  const branchIds = branches.map((b) => b._id);
  if (!branchIds.length) {
    return res.status(200).json(new ApiResponse(200, [], 'No branches found for the given filter'));
  }

  // Determine the date range and aggregation granularity.
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

  // Build the aggregation pipeline.
  const pipeline = [
    // Filter by date range.
    { $match: { createdAt: { $gte: startDateVal, $lte: endDateVal } } },
    // Sort by associateBin and createdAt (descending) to pick the latest record per bin.
    { $sort: { associateBin: 1, createdAt: -1 } },
    // Join with dustbins using pipeline-style $lookup so we can filter by branch.
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
    // For hourly aggregation (filter = "today" or zoomDate provided).
    pipeline.push({ $addFields: { hour: { $hour: '$createdAt' } } });
    // Group by bin, hour, and bin type to pick the latest reading per bin per hour.
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
    // Group by hour and bin type to sum the weights across bins.
    pipeline.push({
      $group: {
        _id: { hour: '$_id.hour', binType: '$_id.binType' },
        totalWeight: { $sum: '$latestWeight' },
      },
    });
    // Pivot the data so that each document represents an hour with an object mapping bin types to weights.
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
    // For daily aggregation.
    pipeline.push({
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
      },
    });
    pipeline.push({ $sort: { associateBin: 1, createdAt: -1 } });
    // Group by bin, day, and bin type.
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
    // Group by day and bin type to sum weights.
    pipeline.push({
      $group: {
        _id: { day: '$_id.day', binType: '$_id.binType' },
        totalWeight: { $sum: '$latestWeight' },
      },
    });
    // Pivot the data so that each document represents a day.
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

  // Execute aggregation with allowDiskUse enabled.
  const result = await Waste.aggregate(pipeline, { allowDiskUse: true });
  return res
    .status(200)
    .json(new ApiResponse(200, result, 'Waste trend chart data retrieved successfully'));
});

/**
 * getWasteDispositionRates
 * GET /api/v1/analytics/wasteDispositionRates
 *
 * Returns time-series data for an area chart comparing:
 *   - Landfill Waste: Sum of latest readings from bins with dustbinType "General Waste"
 *   - Diverted Waste: Sum of latest readings from bins with any other dustbinType.
 *
 * For filter "today", data is aggregated hourly; otherwise, daily.
 *
 * For non-SuperAdmin users, if no explicit branch/company/orgUnit filter is provided,
 * additional filtering is applied based on the logged-in user's OrgUnit.
 */
const getWasteDispositionRates = asyncHandler(async (req, res) => {
  const { branchId, companyId, orgUnitId, filter } = req.query;

  // Initialize branch filter.
  let branchFilter = { isdeleted: false };

  // Check for explicit filters first.
  if (branchId) {
    if (!mongoose.Types.ObjectId.isValid(branchId))
      throw new ApiError(400, 'Invalid branchId format');
    branchFilter._id = new mongoose.Types.ObjectId(branchId);
  } else if (companyId) {
    if (!mongoose.Types.ObjectId.isValid(companyId))
      throw new ApiError(400, 'Invalid companyId format');
    branchFilter.associatedCompany = new mongoose.Types.ObjectId(companyId);
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
    if (orgUnit.type === 'Branch' && orgUnit.branchAddress) {
      branchFilter._id = new mongoose.Types.ObjectId(orgUnit.branchAddress);
    } else if (orgUnit.type === 'City' && orgUnit.name) {
      branchFilter.city = orgUnit.name;
    } else if (orgUnit.type === 'Country' && orgUnit.name) {
      branchFilter.country = orgUnit.name;
    } else if ((orgUnit.type === 'Region' || orgUnit.type === 'State') && orgUnit.name) {
      branchFilter.subdivision = orgUnit.name;
    }
  } else {
    // If no explicit filter is provided, apply user-based filtering.
    if (req.user && req.user.role !== 'SuperAdmin' && req.user.OrgUnit) {
      branchFilter.associatedCompany = req.user.company;
      const userOrgUnit = req.user.OrgUnit;
      if (userOrgUnit.type === 'Branch' && userOrgUnit.branchAddress) {
        branchFilter._id = new mongoose.Types.ObjectId(userOrgUnit.branchAddress);
      } else if (userOrgUnit.type === 'City') {
        branchFilter.city = userOrgUnit.name;
      } else if (userOrgUnit.type === 'Country') {
        branchFilter.country = userOrgUnit.name;
      } else if (userOrgUnit.type === 'Region' || userOrgUnit.type === 'State') {
        branchFilter.subdivision = userOrgUnit.name;
      }
    }
  }

  // Retrieve branch IDs based on branchFilter.
  const branches = await BranchAddress.find(branchFilter).select('_id').lean();
  const branchIds = branches.map((b) => b._id);
  if (!branchIds.length) {
    return res.status(200).json(new ApiResponse(200, [], 'No branches found for the given filter'));
  }

  // Determine date range and aggregation granularity.
  const now = new Date();
  let startDateVal, endDateVal;
  let isHourly = false;
  if (filter === 'today') {
    ({ startDate: startDateVal, endDate: endDateVal } = getUTCDayRange(now));
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
    // Calculate landfill and diverted waste per bin per hour.
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
  getLatestBinWeight,
  getBinStatus,
  getAdminOverview,
  getMinimalOverview,
  getWasteLast7Days,
  getActivityFeed,
  getLeaderboardData,
  getWasteTrendChart,
  getWasteDispositionRates,
};
