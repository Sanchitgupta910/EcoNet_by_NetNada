import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Dustbin } from "../models/dustbin.models.js";

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



export { addDustbin,
    getCurrentWeight,
    
 };