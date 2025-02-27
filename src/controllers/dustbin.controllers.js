import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Dustbin } from "../models/dustbin.models.js";
import { Waste } from "../models/waste.models.js";
import mongoose from "mongoose";
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths, subDays
} from "date-fns";

/**
 * Controller to add multiple dustbins.
 * Validates input and prevents adding duplicate bins for a branch.
 */
const addDustbin = asyncHandler(async (req, res) => {
  const { binCapacity, branchAddress } = req.body;

  // Validate required fields.
  if (!branchAddress || !binCapacity) {
    throw new ApiError(400, "Branch and bin capacity are required.");
  }

  const dustbinTypes = ['General Waste', 'Commingled', 'Organic', 'Paper & Cardboard'];

  // Check if dustbins already exist for the branch.
  const existingDustbin = await Dustbin.findOne({ branchAddress, dustbinType: { $in: dustbinTypes } });
  if (existingDustbin) {
    throw new ApiError(409, "Dustbins for this branch already exist.");
  }

  // Prepare data for bulk insertion.
  const dustbinsData = dustbinTypes.map((type) => ({
    dustbinType: type,
    binCapacity,
    branchAddress,
  }));

  try {
    const dustbins = await Dustbin.insertMany(dustbinsData);
    return res.status(201).json(
      new ApiResponse(201, dustbins, "Dustbins added successfully!")
    );
  } catch (error) {
    throw new ApiError(500, "Failed to add dustbins. Please try again.");
  }
});

/**
 * Controller to get the current weight of a specific dustbin.
 */
const getCurrentWeight = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const dustbin = await Dustbin.findById(id).select("currentWeight");
  if (!dustbin) {
    throw new ApiError(404, "Dustbin not found.");
  }
  return res.status(200).json(
    new ApiResponse(200, { currentWeight: dustbin.currentWeight }, "Dustbin weight fetched successfully!")
  );
});

/**
 * aggregatedWasteData
 * --------------------------------------------
 * Aggregates waste data for a given branch using a time filter.
 * 
 * Steps:
 * 1. Extract branchId and filter from query parameters (default: "today").
 * 2. Calculate the date range based on the filter:
 *    - "today": from startOfDay to endOfDay.
 *    - "thisWeek": current week.
 *    - "lastWeek": previous week.
 *    - "lastMonth": previous month.
 * 3. Build an aggregation pipeline:
 *    - Conditionally filter waste records by the calculated date range.
 *    - Lookup and join waste records with dustbin details.
 *    - Filter records by branch.
 *    - Sort records by createdAt descending.
 *    - Group records by bin to obtain the latest waste weight.
 *    - Lookup dustbin details and project bin type and capacity.
 * 4. If filter is "today" and no records are found, return default data (latestWeight = 0) for each bin in the branch.
 * 5. Additionally, if the filter is "today" and current time is between 10:00 and 10:59 AM, 
 *    retrieve yesterday's latest waste data and compare. If a bin's weight today equals yesterday's,
 *    add a field 'notEmptied: true' to indicate that the bin has not been emptied.
 * 6. Emit the aggregated data via Socket.io for real-time updates.
 * 7. Return the aggregated data in the response.
 *
 * @route GET /api/v1/dustbin/aggregated?branchId=<branchId>&filter=<filter>
 */
const aggregatedWasteData = asyncHandler(async (req, res) => {
  const { branchId, filter = "today" } = req.query;
  if (!branchId) {
    throw new ApiError(400, "branchId is required");
  }

  // --- Step 2: Calculate Date Range Based on Filter ---
  let dateMatchStage = {};
  if (req.query.filter) {
    let startDate, endDate;
    const now = new Date();
    switch (req.query.filter) {
      case "today":
        startDate = startOfDay(now);
        endDate = endOfDay(now);
        break;
      case "thisWeek":
        startDate = startOfWeek(now);
        endDate = endOfWeek(now);
        break;
      case "lastWeek":
        const lastWeekDate = subWeeks(now, 1);
        startDate = startOfWeek(lastWeekDate);
        endDate = endOfWeek(lastWeekDate);
        break;
      case "lastMonth":
        const lastMonthDate = subMonths(now, 1);
        startDate = startOfMonth(lastMonthDate);
        endDate = endOfMonth(lastMonthDate);
        break;
      default:
        startDate = startOfDay(now);
        endDate = endOfDay(now);
    }
    dateMatchStage = {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    };
  }

  // --- Step 3: Build Aggregation Pipeline ---
  const pipeline = [
    // Apply date filter if provided.
    ...(req.query.filter ? [dateMatchStage] : []),
    {
      $lookup: {
        from: "dustbins",
        localField: "associateBin",
        foreignField: "_id",
        as: "binData"
      }
    },
    { $unwind: "$binData" },
    {
      $match: {
        "binData.branchAddress": new mongoose.Types.ObjectId(branchId)
      }
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$associateBin",
        latestWeight: { $first: "$currentWeight" },
        latestCreatedAt: { $first: "$createdAt" }
      }
    },
    {
      $lookup: {
        from: "dustbins",
        localField: "_id",
        foreignField: "_id",
        as: "binDetails"
      }
    },
    { $unwind: "$binDetails" },
    {
      $project: {
        _id: 1,
        latestWeight: 1,
        binName: "$binDetails.dustbinType",
        binCapacity: "$binDetails.binCapacity"
      }
    }
  ];

  // --- Step 4: Execute Aggregation ---
  let result = await Waste.aggregate(pipeline);

  // If filter is "today" and no records are found, return default data with weight 0.
  if (filter === "today" && (!result || result.length === 0)) {
    const bins = await Dustbin.find({ branchAddress: branchId });
    result = bins.map(bin => ({
      _id: bin._id,
      latestWeight: 0,
      binName: bin.dustbinType,
      binCapacity: bin.binCapacity
    }));
  }

  // --- Step 5: Check for "Not Emptied" Condition at 10 AM ---
  // Only apply this logic for the "today" filter.
  if (filter === "today") {
    const now = new Date();
    // Check if current time is between 10:00 and 10:59 AM.
    if (now.getHours() === 10) {
      // Calculate yesterday's date range.
      const yesterday = subDays(now, 1);
      const yesterdayStart = startOfDay(yesterday);
      const yesterdayEnd = endOfDay(yesterday);

      // Build aggregation pipeline for yesterday's data.
      const yesterdayPipeline = [
        {
          $match: {
            createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }
          }
        },
        {
          $lookup: {
            from: "dustbins",
            localField: "associateBin",
            foreignField: "_id",
            as: "binData"
          }
        },
        { $unwind: "$binData" },
        {
          $match: {
            "binData.branchAddress": new mongoose.Types.ObjectId(branchId)
          }
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$associateBin",
            latestWeight: { $first: "$currentWeight" }
          }
        }
      ];

      const yesterdayResult = await Waste.aggregate(yesterdayPipeline);
      // Build a map of bin _id to yesterday's weight.
      const yesterdayMap = {};
      yesterdayResult.forEach(item => {
        yesterdayMap[item._id.toString()] = item.latestWeight;
      });
      // Add a flag 'notEmptied' for bins where today's weight equals yesterday's.
      result = result.map(bin => {
        const binIdStr = bin._id.toString();
        const yesterdayWeight = yesterdayMap[binIdStr] || 0;
        return { ...bin, notEmptied: bin.latestWeight === yesterdayWeight };
      });
    }
  }

  // --- Step 6: Emit the Aggregated Data via Socket.io ---
  const io = req.app.locals.io;
  if (io) {
    io.emit('binWeightUpdated', result);
  }

  // --- Step 7: Return the Aggregated Data in the Response ---
  return res.status(200).json(new ApiResponse(200, result, "Aggregated waste data fetched successfully"));
});

export { addDustbin, getCurrentWeight, aggregatedWasteData };
