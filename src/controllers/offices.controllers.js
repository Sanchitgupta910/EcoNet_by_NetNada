import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { BranchAddress } from '../models/branchAddress.models.js';

/**
 
 *
 * This endpoint retrieves a list of offices (branch addresses) with details
 * such as office name, address, city, and the types of bins installed.
 * This is used in the Offices tab of the admin dashboard.
 */
export const getOffices = asyncHandler(async (req, res) => {
  // Optional filter: companyId to list only offices for a given company.
  const { companyId } = req.query;
  let filter = { isdeleted: false };
  if (companyId) {
    filter.associatedCompany = companyId;
  }

  const offices = await BranchAddress.find(filter).lean();
  if (!offices || offices.length === 0) {
    return res.status(200).json(new ApiResponse(200, [], 'No offices found'));
  }
  return res.status(200).json(new ApiResponse(200, offices, 'Offices retrieved successfully'));
});
