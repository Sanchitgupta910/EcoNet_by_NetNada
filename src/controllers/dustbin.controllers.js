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
 * This controller aggregates waste data for a given branch.
 * It performs the following steps:
 *   1. Joins waste records with dustbin details.
 *   2. Filters records to only include waste for bins belonging to the specified branch.
 *   3. Sorts records by creation time in descending order.
 *   4. Groups records by bin to get the most recent (latest) waste weight.
 *   5. Looks up bin details (binName and binCapacity) and projects these fields.
 *   6. Emits a Socket.io event ("binWeightUpdated") with the aggregated data.
 *
 * TEMP CODE:
 *   A mock function is provided to simulate updated waste data. This function:
 *   - For each aggregated bin record, calculates a new weight by adding a random increment.
 *   - Persists a new Waste record in the database.
 *   - Returns the new data so it can be emitted via Socket.io.
 *
 * @route GET /api/v1/dustbin/aggregated?branchId=<branchId>
 */
const aggregatedWasteData = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) {
    throw new ApiError(400, "branchId is required");
  }

  // Aggregation pipeline to retrieve the latest waste record per bin.
  const pipeline = [
    {
      $lookup: {
        from: "dustbins", // Must match the Dustbin collection name
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
        binName: "$binDetails.dustbinType",  // Adjust if your field name is different.
        binCapacity: "$binDetails.binCapacity"
      }
    }
  ];

  // Execute the aggregation.
  const result = await Waste.aggregate(pipeline);

  // Emit the aggregated data via Socket.io.
  const io = req.app.locals.io;
  if (io) {
    io.emit('binWeightUpdated', result);
  }

  /**
   * TEMP CODE: Mock function to simulate increasing waste data.
   * This function:
   *   - Iterates over each bin record from the aggregation result.
   *   - Calculates a new weight by adding a random increment (between 2 and 4 kg).
   *   - Persists a new Waste record in the database with the updated weight.
   *   - Returns the updated bin data to be emitted via Socket.io.
   *
   * Remove or disable this block once the real hardware data is available.
   */
  async function mockGenerateWasteDataAndPersist() {
    const getRandomIncrement = () => Math.floor(Math.random() * 3) + 2; // Random increment: 2-4 kg
    const newData = [];
    for (const bin of result) {
      // Calculate new weight that is greater than the last recorded weight.
      const newWeight = bin.latestWeight + getRandomIncrement();
      // Create a new waste record so that the change is persistent.
      await Waste.create({
        associateBin: bin._id,
        currentWeight: newWeight,
      });
      // Build updated bin object.
      newData.push({
        _id: bin._id,
        latestWeight: newWeight,
        binName: bin.binName,
        binCapacity: bin.binCapacity,
      });
    }
    return newData;
  }

  // Uncomment the following block to enable persistent mock data generation every 10 seconds.
  /*
  setInterval(async () => {
    try {
      const mockData = await mockGenerateWasteDataAndPersist();
      console.log("Generated and persisted mock waste data:", mockData);
      io.emit('binWeightUpdated', mockData);
    } catch (err) {
      console.error("Error in mockGenerateWasteDataAndPersist:", err);
    }
  }, 10000);
  */

  return res.status(200).json(new ApiResponse(200, result, "Aggregated waste data fetched successfully"));
});

export { addDustbin, getCurrentWeight, aggregatedWasteData };
