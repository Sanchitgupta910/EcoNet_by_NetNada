import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { createOrgUnitsForBranchAddressService } from './orgUnit.controllers.js';

/**
 * createNewAddress
 * ------------------
 * Creates a new branch address record and automatically triggers the creation
 * of the associated organizational units (Country, Region, City, and Branch).
 *
 * Expected fields in req.body:
 *   - officeName, address, city, subdivision, subdivisionType, postalCode, country, associatedCompany, companyName
 *
 * Edge Cases:
 *   - Validates required fields.
 *   - Prevents duplicate branch entries.
 *   - If any error occurs during OrgUnit creation, it is handled gracefully.
 *
 * @route POST /api/v1/branchAddress/create
 */
const createNewAddress = asyncHandler(async (req, res) => {
  try {
    const {
      officeName,
      address,
      city,
      subdivision,
      subdivisionType,
      postalCode,
      country,
      associatedCompany,
      companyName, // new field used to build OrgUnit names
    } = req.body;

    // Validate required fields.
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
        companyName,
      ].some((field) => !field || field.trim() === '')
    ) {
      throw new ApiError(400, 'All the fields are required!');
    }

    // Check if a branch with the same officeName already exists.
    const existedBranch = await BranchAddress.findOne({ officeName });
    if (existedBranch) {
      throw new ApiError(409, 'Branch already exists');
    }

    // Create the new branch address record.
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

    // Automatically create the OrgUnit hierarchy for the new branch.
    // Pass companyName along with other branch details so that OrgUnit names are properly formatted.
    const orgUnits = await createOrgUnitsForBranchAddressService({
      companyId: associatedCompany,
      companyName,
      officeName: branchRecord.officeName,
      city: branchRecord.city,
      subdivision: branchRecord.subdivision,
      country: branchRecord.country,
      branchAddressId: branchRecord._id,
    });

    // Return a combined response including the branch and OrgUnit details.
    return res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { branchRecord, orgUnits },
          'Branch Address and associated Org Units created successfully',
        ),
      );
  } catch (error) {
    console.error('Error in createNewAddress:', error);
    throw error;
  }
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
 *   1. Extract the addressId from the request body.
 *   2. Check if the branch exists using the addressId.
 *   3. Mark the branch as deleted (soft delete) by setting its isdeleted flag.
 *   4. Return a success response with the deleted branch details.
 *
 * @route DELETE /api/v1/branchAddress/delete
 */
const deleteBranch = asyncHandler(async (req, res) => {
  const { addressId } = req.body;

  if (!addressId) {
    throw new ApiError(400, 'Address id is required');
  }

  // Check if the branch exists using the addressId.
  const existedBranch = await BranchAddress.findById(addressId);
  if (!existedBranch) {
    throw new ApiError(404, 'Company branch not found');
  }

  // Soft-delete the branch.
  const deletedBranch = await BranchAddress.findByIdAndUpdate(
    addressId,
    { isdeleted: true },
    { new: true },
  );

  return res
    .status(200)
    .json(new ApiResponse(200, deletedBranch, 'Company branch deleted successfully'));
});

export { createNewAddress, updateBranchDetails, deleteBranch };
