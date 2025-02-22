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
 * aggregatedWasteData
 * --------------------------------------------
 * This endpoint aggregates waste data for a branch by:
 *   1. Joining waste records with dustbin details.
 *   2. Filtering records by the specified branch.
 *   3. Sorting records by createdAt (most recent first).
 *   4. Grouping by dustbin to obtain the latest waste weight.
 *   5. Looking up bin details and projecting binName and binCapacity.
 *   6. Emitting a real-time update via Socket.io.
 *
 * TEMP CODE: A mock function is provided to simulate increasing waste weights.
 * This is temporary until the hardware data is available.
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

  // Execute the aggregation.
  const result = await Waste.aggregate(pipeline);

  // Emit socket event for real-time update.
  const io = req.app.locals.io;
  if (io) {
    io.emit('binWeightUpdated', result);
  }

  // TEMP CODE: Generate mock updated data that simulates weight increasing.
  // This block is temporary until real hardware data is captured.
  function mockGenerateWasteData() {
    const getRandomIncrement = () => Math.floor(Math.random() * 3) + 2; // Increments between 2 and 4
    return result.map((bin) => ({
      ...bin,
      latestWeight: bin.latestWeight + getRandomIncrement()
    }));
  }
  // Uncomment the following block to use the mock data for testing.

  // setInterval(() => {
  //   const mockData = mockGenerateWasteData();
  //   io.emit('binWeightUpdated', mockData);
  // }, 1000);


  return res.status(200).json(new ApiResponse(200, result, "Aggregated waste data fetched successfully"));
});


export { addDustbin, getCurrentWeight, aggregatedWasteData };
