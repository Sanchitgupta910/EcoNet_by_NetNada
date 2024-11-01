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


export { addDustbin,
    getCurrentWeight
 };