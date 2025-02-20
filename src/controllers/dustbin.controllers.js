import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Dustbin } from "../models/dustbin.models.js";
import { Waste } from "../models/waste.models.js";
import mongoose from "mongoose";

const addDustbin = asyncHandler(async (req, res) => {
    /*
    Steps to add multiple dustbins:
    1. Extract required fields from the request body
    2. Validate required fields for each dustbin
    3. Check if bins already exist for that branch
    4. Add dustbins to the database in bulk
    5. Return success response or error if it fails
    */

    const { binCapacity, branchAddress } = req.body;

    // Validate required fields
    if (!branchAddress || !binCapacity) {
        throw new ApiError(400, "Branch and bin capacity are required.");
    }
    
    const dustbinTypes = ['General Waste', 'Commingled', 'Organics', 'Paper & Cardboard'];

    // Check if bins already exist for that branch
    const existingDustbin = await Dustbin.findOne({ branchAddress, dustbinType: { $in: dustbinTypes } });
    
    // If a dustbin is found, that means dustbins already exist for this branch
    if (existingDustbin) {
        throw new ApiError(409, "Dustbins for this branch already exist.");
    }

    // Prepare data for new dustbins
    const dustbinsData = dustbinTypes.map((type) => ({
        dustbinType: type,
        binCapacity,
        branchAddress,
    }));

    // Insert the new dustbins in the database
    try {
        const dustbins = await Dustbin.insertMany(dustbinsData);
        return res.status(201).json(
            new ApiResponse(201, dustbins, "Dustbins added successfully!")
        );
    } catch (error) {
        throw new ApiError(500, "Failed to add dustbins. Please try again.");
    }
});

//get current weight of the dustbin
const getCurrentWeight = asyncHandler(async (req, res) => {
    const { id } = req.params
    const dustbin = await Dustbin.findById(id).select("currentWeight")
    if (!dustbin) {
        throw new ApiError(404, "Dustbin not found.")
    }
    return res
    .status(200)
    .json(
        new ApiResponse(200, {currentWeight: dustbin.currentWeight}, "Dustbin weight fetched successfully!")  
    )

})

/**
 * aggregatedWasteData
 * --------------------------------------------
 * Steps:
 *   1. Extract branchId from the query parameters.
 *   2. Filter waste records to only include those associated with bins belonging to that branch.
 *   3. Group waste records by bin (associateBin) and sum the currentWeight.
 *   4. Join (lookup) the Dustbin collection to fetch bin details (name, capacity).
 *   5. Return an object mapping each bin to its aggregated waste weight along with its details.
 *
 * @route GET /api/v1/dustbin/aggregated?branchId=<branchId>
 */
const aggregatedWasteData = asyncHandler(async (req, res) => {
    const { branchId } = req.query;
    if (!branchId) {
      throw new Error("branchId is required");
    }
  
    // Step 3: Build the aggregation pipeline.
    const pipeline = [
      // Match waste records for bins that belong to the selected branch.
      // This assumes your Dustbin documents have a field "branchAddress" that is an ObjectId.
      {
        $lookup: {
          from: "dustbins", // Make sure this matches your Dustbin collection name
          localField: "associateBin",
          foreignField: "_id",
          as: "binData"
        }
      },
      // 2. Unwind the binData array
      { $unwind: "$binData" },
      // 3. Filter waste records to only those for the selected branch
      {
        $match: {
          "binData.branchAddress": new mongoose.Types.ObjectId(branchId)
        }
      },
      // 4. Sort the documents so that the most recent ones come first
      { $sort: { createdAt: -1 } },
      // 5. Group by associateBin and pick the first (latest) weight
      {
        $group: {
          _id: "$associateBin",
          latestWeight: { $first: "$currentWeight" },
          // Optionally capture the latest createdAt if needed:
          latestCreatedAt: { $first: "$createdAt" }
        }
      },
      // 6. Lookup dustbin details to include bin name and capacity
      {
        $lookup: {
          from: "dustbins",
          localField: "_id",
          foreignField: "_id",
          as: "binDetails"
        }
      },
      { $unwind: "$binDetails" },
      // 7. Project the fields to return
      {
        $project: {
          _id: 1,
          latestWeight: 1,
          binName: "$binDetails.dustbinType", // Adjust if you have a separate bin name field
          binCapacity: "$binDetails.binCapacity"
        }
      }
    ];
  
    // Execute the aggregation.
    const result = await Waste.aggregate(pipeline);
    // Transform result into an object keyed by bin id (or type) if needed.
    return res.status(200).json(new ApiResponse(200, result, "Aggregated waste data fetched successfully"));
  });



export { addDustbin,
    getCurrentWeight,
    aggregatedWasteData
    
 };