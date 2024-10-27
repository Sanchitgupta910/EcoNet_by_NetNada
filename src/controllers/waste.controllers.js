import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Waste } from "../models/waste.models.js";
import { Dustbin } from "../models/dustbin.models.js";

// Function to add a waste entry
const addWaste = asyncHandler(async (req, res) => {
    /*
    Steps to add waste:
    1. Extract required fields from the request body
    2. Validate the associated dustbin exists
    3. Create a new waste entry in the database
    4. Return success response or error if it fails
    */

    const { associateBin, currentWeight } = req.body;

    // Validate required fields
    if (!associateBin || !currentWeight) {
        throw new ApiError(400, "Both 'associateBin' and 'currentWeight' are required.");
    }

    // Check if the associated dustbin exists
    const dustbin = await Dustbin.findById(associateBin);
    if (!dustbin) {
        throw new ApiError(404, "Associated dustbin not found.");
    }

    // Create the waste entry in the database
    const wasteRecord = await Waste.create({
        associateBin,
        currentWeight
    });

    // Return success response with the created waste entry
    return res.status(201).json(
        new ApiResponse(201, wasteRecord, "Waste record added successfully!")
    );
});

export { addWaste };
