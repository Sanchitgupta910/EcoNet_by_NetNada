import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Dustbin } from "../models/dustbin.models.js";
import { Waste } from "../models/waste.models.js";
import mongoose from "mongoose";

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
    
    const dustbinTypes = ['General Waste', 'Commingled', 'Organics', 'Paper & Cardboard'];

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
 * Controller to aggregate waste data for a branch and emit real-time updates.
 * It performs the following steps:
 *   1. Joins waste records with dustbin details.
 *   2. Filters records by branch.
 *   3. Groups by dustbin to get the latest weight.
 *   4. Emits a socket event before returning the result.
 *
 * @route GET /api/v1/dustbin/aggregated?branchId=<branchId>
 */
const aggregatedWasteData = asyncHandler(async (req, res) => {
    const { branchId } = req.query;
    if (!branchId) {
      throw new ApiError(400, "branchId is required");
    }
  
    // Build aggregation pipeline.
    const pipeline = [
      {
        $lookup: {
          from: "dustbins", // Ensure this matches your Dustbin collection name.
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
  
    // Execute aggregation.
    const result = await Waste.aggregate(pipeline);

    // Emit socket event for real-time update before sending the response.
    const io = req.app.locals.io;
    if (io) {
      console.log("Emitting binWeightUpdated event with data:", result);
      io.emit('binWeightUpdated', result);
    } else {
      console.warn("Socket.io instance not found. Skipping emission.");
    }
    return res.status(200).json(new ApiResponse(200, result, "Aggregated waste data fetched successfully"));
});
export { addDustbin, getCurrentWeight, aggregatedWasteData };
