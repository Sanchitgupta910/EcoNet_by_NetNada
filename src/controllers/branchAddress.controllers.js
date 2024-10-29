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

//update branch details
const updateBranchDetails = asyncHandler(async (req, res) => {
    /*
    Steps to update branch details:
    1. Get the details from the frontend
    2. Validate the required fields - if empty
    3. Check if the branch already exists using the domain
    4. Update the branch record in the DB
    5. Ensure the entry is created
    6. Send success or error response
    */

    const { branchName, address, city, state, postalCode, country, associatedCompany } = req.body;
    if ([branchName, address, city, state, postalCode, country, associatedCompany].some((field) => !field || field.trim === "")) {
        throw new ApiError(400, "All the fields are required!");
    }

    // Check if the company branch already exists in the DB using the domain
    const existedBranch = await BranchAddress.findOne({ branchName });
    if (!existedBranch) {
        throw new ApiError(404, "Company branch not found");
    }

    // Update the branch record in the DB
    const updatedBranch = await BranchAddress.findOneAndUpdate(
        { branchName },
        { branchName, address, city, state, postalCode, country, associatedCompany },
        { new: true }
    );

    // Return success message along with the branch details
    return res.status(200).json(
        new ApiResponse(200, updatedBranch, "Company branch updated successfully")
    )
})

//delete branch using isdeleted
const deleteBranch = asyncHandler(async (req, res) => {
    const { branchName } = req.body;
    const existedBranch = await BranchAddress.findOne({ branchName });
    if (!existedBranch) {
        throw new ApiError(404, "Company branch not found");
    }
    const deletedBranch = await BranchAddress.findOneAndUpdate(
        { branchName },
        { isdeleted: true },
        { new: true }
    );
    return res.status(200).json(
        new ApiResponse(200, deletedBranch, "Company branch deleted successfully")
    );
});

export {
    createNewAddress,
    updateBranchDetails,
    deleteBranch
}