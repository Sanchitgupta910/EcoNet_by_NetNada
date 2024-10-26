import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Address } from "../models/branchAddress.models.js"

const createNewAddress = asyncHandler( async(req, res) => {

    /* 
    
    Steps to create a new address
    1. Accept data from frontend
    2. Validate the required fields

    */



} )

export {
    createNewAddress
}