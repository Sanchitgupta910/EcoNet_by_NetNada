import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Dustbin } from "../models/dustbin.models.js";

const addDustbin = asyncHandler(async (req, res) => {
    /*
    Steps to add multiple dustbins:
    1. Extract required fields from the request body
    2. Validate required fields for each dustbin
    3. check if bins already exist for that branch
    4. Add dustbins to the database in bulk
    5. Return success response or error if it fails
    */

    const { branchName, currentWeight } = req.body;

    // Validate required fields for each dustbin
    if (!branchName || !currentWeight) {
        throw new ApiError(400, "Both 'branchName' and 'currentWeight' are required.");
    }
    const dustbinTypes = ['Landfill', 'Recycling', 'Paper', 'Organic'];

    // Check if bins already exist for that branch  
    const existingDustbin = await Dustbin.findOne({ branchName, dustbinType: { $in: dustbinTypes } });
    if (existingDustbin.length) {
        throw new ApiError(409, "Dustbins for this branch already exists.");
    }
    
    // prepare for dn update
    const dustbinsData = dustbinTypes.map((type) => ({
        dustbinType: type,
        binCapacity,
        branchAddress,
    }));

    //update db with new data using try catch
    try {
        const dustbins = await Dustbin.insertMany(dustbinsData);
        return res
        .status(201)
        .json(
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
    getCurrentWeight
 };