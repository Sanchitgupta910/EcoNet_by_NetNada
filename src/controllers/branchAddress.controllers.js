import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { BranchAddress } from "../models/branchAddress.models.js"

const createNewAddress = asyncHandler( async(req, res) => {

    /* 
    
    Steps to create a new address
    1. Accept data from frontend
    2. Validate the required fields
    3. check if the address is already present
    4. create a new entry in the db
    5. throw success or error response
    */

    try {
        const {branchName, address, city, state, postalCode, country, associatedCompany} = req.body;
    
        //validate required fields 
        if ([branchName, address, city, state, postalCode, country,associatedCompany].some((field) => !field || field.trim === "")) {
            throw new ApiError(400, "All the fields are required!");
        }
    
        // Check if the company branch already exists in the DB using the domain
        const existedBranch = await BranchAddress.findOne({ branchName });
        if (existedBranch) {
            throw new ApiError(409, "Company already exists");
        }
    
        // Create a new entry in the DB
        const branchRecord = await BranchAddress.create({
            branchName, address, city, state, postalCode, country,associatedCompany
        });
        console.log(branchRecord)
    
        // Return success message along with the branch details
        return res.status(201).json(
            new ApiResponse(201, branchRecord, "Company branch created successfully")
        );
    } catch (error) {
        console.log(error)
    }
});

export {
    createNewAddress
}