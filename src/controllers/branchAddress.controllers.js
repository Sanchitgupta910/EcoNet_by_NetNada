import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { BranchAddress } from "../models/branchAddress.models.js";

/**
 * createNewAddress
 * --------------------------------------------
 * Steps to create a new address:
 *   1. Accept data from the frontend.
 *   2. Validate that all required fields are provided.
 *   3. Check if a branch with the same name already exists.
 *   4. Create a new branch address entry in the database.
 *   5. Return a success response with the branch details.
 *
 * @route POST /api/v1/branchAddress/create
 */
const createNewAddress = asyncHandler(async (req, res) => {
  // Step 1: Extract required fields from the request body.
  const { officeName, address, city, region, postalCode, country, associatedCompany } = req.body;

  // Step 2: Validate that all required fields are provided and not empty.
  if (
    [officeName, address, city, region, postalCode, country, associatedCompany].some(
      (field) => !field || field.trim() === ""
    )
  ) {
    throw new ApiError(400, "All the fields are required!");
  }

  // Step 3: Check if the branch already exists using the officeName.
  const existedBranch = await BranchAddress.findOne({ officeName });
  if (existedBranch) {
    throw new ApiError(409, "Branch already exists");
  }

  // Step 4: Create a new branch address entry in the database.
  const branchRecord = await BranchAddress.create({
    officeName,
    address,
    city,
    region,
    postalCode,
    country,
    associatedCompany,
  });
  console.log(branchRecord);

  // Step 5: Return a success response with the created branch address details.
  return res.status(201).json(
    new ApiResponse(201, branchRecord, "Company branch created successfully")
  );
});

/**
 * updateBranchDetails
 * --------------------------------------------
 * Steps to update branch details:
 *   1. Extract the updated details from the frontend.
 *   2. Validate that all required fields are provided.
 *   3. Check if the branch exists using the officeName.
 *   4. Update the branch record in the database.
 *   5. Return a success response with the updated branch details.
 *
 * @route PUT /api/v1/branchAddress/update
 */
const updateBranchDetails = asyncHandler(async (req, res) => {
  // Step 1: Extract updated fields from the request body.
  const { officeName, address, city, region, postalCode, country, associatedCompany } = req.body;

  // Step 2: Validate that all required fields are provided.
  if (
    [officeName, address, city, region, postalCode, country, associatedCompany].some(
      (field) => !field || field.trim() === ""
    )
  ) {
    throw new ApiError(400, "All the fields are required!");
  }

  // Step 3: Check if the branch exists using the officeName.
  const existedBranch = await BranchAddress.findOne({ officeName });
  if (!existedBranch) {
    throw new ApiError(404, "Company branch not found");
  }

  // Step 4: Update the branch record in the database.
  const updatedBranch = await BranchAddress.findOneAndUpdate(
    { officeName },
    { officeName, address, city, region, postalCode, country, associatedCompany },
    { new: true }
  );

  // Step 5: Return a success response with the updated branch details.
  return res.status(200).json(
    new ApiResponse(200, updatedBranch, "Company branch updated successfully")
  );
});

/**
 * deleteBranch
 * --------------------------------------------
 * Steps to delete a branch:
 *   1. Extract the officeName from the request body.
 *   2. Check if the branch exists.
 *   3. Mark the branch as deleted (soft delete) by setting its isdeleted flag.
 *   4. Return a success response with the deleted branch details.
 *
 * @route DELETE /api/v1/branchAddress/delete
 */
const deleteBranch = asyncHandler(async (req, res) => {
  // Step 1: Extract the officeName from the request body.
  const { officeName } = req.body;

  // Step 2: Check if the branch exists.
  const existedBranch = await BranchAddress.findOne({ officeName });
  if (!existedBranch) {
    throw new ApiError(404, "Company branch not found");
  }

  // Step 3: Mark the branch as deleted by updating its isdeleted flag.
  const deletedBranch = await BranchAddress.findOneAndUpdate(
    { officeName },
    { isdeleted: true },
    { new: true }
  );

  // Step 4: Return a success response with the deleted branch details.
  return res.status(200).json(
    new ApiResponse(200, deletedBranch, "Company branch deleted successfully")
  );
});

export {
  createNewAddress,
  updateBranchDetails,
  deleteBranch,
};
