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
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, "branchId is required");
  }

  const now = new Date();
  // Define today's date range
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  // Build the aggregation pipeline to fetch the latest waste data for each dustbin in the branch for today.
  const pipeline = [
    {
      // Filter records to include only today's waste entries.
      $match: {
        createdAt: { $gte: todayStart, $lte: todayEnd }
      }
    },
    {
      // Join waste records with dustbin details.
      $lookup: {
        from: "dustbins",
        localField: "associateBin",
        foreignField: "_id",
        as: "binData"
      }
    },
    { $unwind: "$binData" },
    {
      // Filter records to include only those from the specified branch.
      $match: {
        "binData.branchAddress": new mongoose.Types.ObjectId(branchId)
      }
    },
    // Sort by creation time in descending order to ensure the latest record is at the top.
    { $sort: { createdAt: -1 } },
    {
      // Group by the dustbin to obtain its most recent waste weight from today.
      $group: {
        _id: "$associateBin",
        latestWeight: { $first: "$currentWeight" },
        latestCreatedAt: { $first: "$createdAt" }
      }
    },
    {
      // Look up dustbin details to include type and capacity.
      $lookup: {
        from: "dustbins",
        localField: "_id",
        foreignField: "_id",
        as: "binDetails"
      }
    },
    { $unwind: "$binDetails" },
    {
      // Project the required fields for the bin cards.
      $project: {
        _id: 1,
        latestWeight: 1,
        binName: "$binDetails.dustbinType",
        binCapacity: "$binDetails.binCapacity"
      }
    }
  ];

  let result;
  try {
    result = await Waste.aggregate(pipeline);
  } catch (error) {
    console.error("Error in aggregatedWasteData pipeline:", error);
    throw new ApiError(500, "Failed to fetch aggregated waste data for bin cards");
  }

  // If no records are found for today, return default data with weight 0 for each dustbin in the branch.
  if (!result || result.length === 0) {
    try {
      const bins = await Dustbin.find({ branchAddress: branchId });
      result = bins.map(bin => ({
        _id: bin._id,
        latestWeight: 0,
        binName: bin.dustbinType,
        binCapacity: bin.binCapacity
      }));
    } catch (error) {
      console.error("Error fetching default bin data:", error);
      throw new ApiError(500, "Failed to fetch default bin data");
    }
  }

  // Check for the "Not Emptied" condition if current time is between 10:00 and 10:59 AM.
  // This logic compares today's latest weight with yesterday's.
  if (now.getHours() === 10) {
    try {
      // Define yesterday's date range.
      const yesterday = subDays(now, 1);
      const yesterdayStart = startOfDay(yesterday);
      const yesterdayEnd = endOfDay(yesterday);

      // Build aggregation pipeline to fetch yesterday's latest waste data for the same branch.
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
      const yesterdayMap = {};
      yesterdayResult.forEach(item => {
        yesterdayMap[item._id.toString()] = item.latestWeight;
      });

      // Add a 'notEmptied' flag if today's weight equals yesterday's weight.
      result = result.map(bin => {
        const binIdStr = bin._id.toString();
        const yesterdayWeight = yesterdayMap[binIdStr] || 0;
        return { ...bin, notEmptied: bin.latestWeight === yesterdayWeight };
      });
    } catch (error) {
      console.error("Error in notEmptied check for aggregatedWasteData:", error);
      // If an error occurs during the check, proceed without the notEmptied flag.
    }
  }

  // Emit real-time update via Socket.io if available.
  const io = req.app.locals.io;
  if (io) {
    io.emit('binWeightUpdated', result);
  }

  return res.status(200).json(new ApiResponse(200, result, "Aggregated waste data fetched successfully"));
});

export { addDustbin, getCurrentWeight, aggregatedWasteData };
