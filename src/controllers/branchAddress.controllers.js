import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { BranchAddress } from '../models/branchAddress.models.js';

/**
 * createNewAddress
 * --------------------------------------------
 * Steps to create a new address:
 *   1. Extract required fields from the request body.
 *   2. Validate that all required fields are provided.
 *   3. Check if a branch with the same officeName already exists.
 *   4. Create a new branch address entry in the database.
 *   5. Return a success response with the branch details.
 *
 * @route POST /api/v1/branchAddress/create
 */
const createNewAddress = asyncHandler(async (req, res) => {
  // Updated extraction to include subdivision and subdivisionType instead of region.
  const {
    officeName,
    address,
    city,
    subdivision,
    subdivisionType,
    postalCode,
    country,
    associatedCompany,
  } = req.body;

  // Validate all required fields.
  if (
    [
      officeName,
      address,
      city,
      subdivision,
      subdivisionType,
      postalCode,
      country,
      associatedCompany,
    ].some((field) => !field || field.trim() === '')
  ) {
    throw new ApiError(400, 'All the fields are required!');
  }

  // Check if a branch with the same officeName already exists.
  const existedBranch = await BranchAddress.findOne({ officeName });
  if (existedBranch) {
    throw new ApiError(409, 'Branch already exists');
  }

  // Create a new branch address entry using the updated fields.
  const branchRecord = await BranchAddress.create({
    officeName,
    address,
    city,
    subdivision,
    subdivisionType,
    postalCode,
    country,
    associatedCompany,
  });
  console.log(branchRecord);

  // Return a success response.
  return res
    .status(201)
    .json(new ApiResponse(201, branchRecord, 'Company branch created successfully'));
});

/**
 * updateBranchDetails
 * --------------------------------------------
 * Steps to update branch details:
 *   1. Extract updated fields (and addressId) from the request body.
 *   2. Validate that all required fields are provided.
 *   3. Check if the branch exists using the addressId.
 *   4. Update the branch record in the database.
 *   5. Return a success response with the updated branch details.
 *
 * @route PUT /api/v1/branchAddress/update
 */
const updateBranchDetails = asyncHandler(async (req, res) => {
  const {
    addressId,
    officeName,
    address,
    city,
    subdivision,
    subdivisionType,
    postalCode,
    country,
    associatedCompany,
  } = req.body;

  // Ensure addressId is provided.
  if (!addressId) {
    throw new ApiError(400, 'Address id is required for update.');
  }

  // Validate all required fields.
  if (
    [
      officeName,
      address,
      city,
      subdivision,
      subdivisionType,
      postalCode,
      country,
      associatedCompany,
    ].some((field) => !field || field.trim() === '')
  ) {
    throw new ApiError(400, 'All the fields are required!');
  }

  // Find the branch using the unique identifier
  const existedBranch = await BranchAddress.findById(addressId);
  if (!existedBranch) {
    throw new ApiError(404, 'Company branch not found');
  }

  // Update the branch record with new data using its _id
  const updatedBranch = await BranchAddress.findByIdAndUpdate(
    addressId,
    {
      officeName,
      address,
      city,
      subdivision,
      subdivisionType,
      postalCode,
      country,
      associatedCompany,
    },
    { new: true },
  );

  return res
    .status(200)
    .json(new ApiResponse(200, updatedBranch, 'Company branch updated successfully'));
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
  const { officeName } = req.body;

  // Check if the branch exists.
  const existedBranch = await BranchAddress.findOne({ officeName });
  if (!existedBranch) {
    throw new ApiError(404, 'Company branch not found');
  }

  // Soft-delete the branch.
  const deletedBranch = await BranchAddress.findOneAndUpdate(
    { officeName },
    { isdeleted: true },
    { new: true },
  );

  return res
    .status(200)
    .json(new ApiResponse(200, deletedBranch, 'Company branch deleted successfully'));
});

export { createNewAddress, updateBranchDetails, deleteBranch };
