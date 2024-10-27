import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Dustbin } from "../models/dustbin.models.js";

const addDustbin = asyncHandler(async (req, res) => {
    /*
    Steps to add multiple dustbins:
    1. Extract required fields from the request body
    2. Validate required fields for each dustbin
    3. Add dustbins to the database in bulk
    4. Return success response or error if it fails
    */

    const { dustbinType, currentWeight, binCapacity, branchAddress } = req.body;

    // Validate that all fields are provided for each dustbin
    if (
        [dustbinType, currentWeight, binCapacity, branchAddress].some((field) => !field)
    ) {
        throw new ApiError(400, "All dustbin fields are required.");
    }

    // Define the 4 types of dustbins to be added
    const dustbinTypes = ['Landfill', 'Recycling', 'Paper', 'Organic'];

    // Create dustbins data with each type
    const dustbinsData = dustbinTypes.map((type) => ({
        dustbinType: type,
        currentWeight,
        binCapacity,
        branchAddress,
    }));

    // Insert the dustbins in bulk to the database
    const dustbins = await Dustbin.insertMany(dustbinsData);

    // Return success response with the created dustbins
    return res.status(201).json(
        new ApiResponse(201, dustbins, "Dustbins added successfully!")
    );
});

export { addDustbin };