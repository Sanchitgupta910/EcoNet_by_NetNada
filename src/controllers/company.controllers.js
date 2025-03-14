import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Company } from '../models/company.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { User } from '../models/user.models.js';
import { Dustbin } from '../models/dustbin.models.js';

/**
 * createNewCompany
 * --------------------------------------------
 * Steps to create a new company:
 *   1. Extract company details from the frontend (CompanyName, domain, noofEmployees).
 *   2. Validate that required fields (CompanyName and domain) are provided and not empty.
 *   3. Check if a company with the given domain already exists.
 *   4. Create a new company record in the database.
 *   5. Emit a Socket.io event with the new company record.
 *   6. Return a success response along with the created company details.
 *
 * @route POST /api/v1/companies/create
 */
const createNewCompany = asyncHandler(async (req, res) => {
  // Step 1: Extract company details from the request body.
  const { CompanyName, domain, noofEmployees, industry } = req.body;

  // Step 2: Validate required fields. (Note: Only CompanyName and domain are required.)
  if (
    [CompanyName, domain, noofEmployees, industry].some((field) => !field || field.trim() === '')
  ) {
    throw new ApiError(400, 'All fields are required!');
  }

  // Step 3: Check if a company with the same domain already exists.
  const existedCompany = await Company.findOne({ domain });
  if (existedCompany) {
    throw new ApiError(409, 'Company already exists');
  }

  // Step 4: Create a new company record in the database.
  const companyRecord = await Company.create({
    CompanyName,
    domain,
    noofEmployees,
    industry,
  });
  console.log(companyRecord);

  // Step 5: Retrieve the Socket.io instance from app.locals and emit the newCompany event.
  const io = req.app.locals.io;
  io.emit('newCompany', companyRecord);

  // Step 6: Return a success response with the company details.
  return res
    .status(201)
    .json(new ApiResponse(201, companyRecord, 'Company record created successfully'));
});

/**
 * updateCompanyDetails
 * --------------------------------------------
 * Steps to update company details:
 *   1. Extract updated company details (CompanyName, domain, noofEmployees) from the frontend.
 *   2. Validate that required fields (CompanyName and domain) are provided and not empty.
 *   3. Check if a company with the given domain exists.
 *   4. Update the company record in the database.
 *   5. Return a success response with the updated company details.
 *
 * @route PUT /api/v1/companies/update
 */
const updateCompanyDetails = asyncHandler(async (req, res) => {
  // Step 1: Extract updated company details from the request body.
  const { CompanyName, domain, noofEmployees, industry } = req.body;

  // Step 2: Validate required fields.
  if ([CompanyName, domain, industry].some((field) => !field || field.trim() === '')) {
    throw new ApiError(400, 'All fields are required!');
  }

  // Step 3: Check if the company exists using the provided domain.
  const existedCompany = await Company.findOne({ domain });
  if (!existedCompany) {
    throw new ApiError(404, 'Company not found');
  }

  // Step 4: Update the company record in the database.
  const updatedCompany = await Company.findOneAndUpdate(
    { domain },
    { CompanyName, domain, noofEmployees, industry },
    { new: true },
  );

  // Step 5: Return a success response with the updated company details.
  return res
    .status(200)
    .json(new ApiResponse(200, updatedCompany, 'Company record updated successfully'));
});

/**
 * deleteCompany
 * --------------------------------------------
 * Steps to delete a company (soft delete):
 *   1. Extract the company's domain from the request body.
 *   2. Check if the company exists.
 *   3. Mark the company as deleted by setting the 'isdeleted' flag to true.
 *   4. Return a success response with the updated company details.
 *
 * @route DELETE /api/v1/companies/delete
 */
const deleteCompany = asyncHandler(async (req, res) => {
  // Step 1: Extract the company's domain from the request body.
  const { domain } = req.body;

  // Step 2: Check if the company exists.
  const existedCompany = await Company.findOne({ domain });
  if (!existedCompany) {
    throw new ApiError(404, 'Company not found');
  }

  // Step 3: Mark the company as deleted (soft delete).
  const deletedCompany = await Company.findOneAndUpdate(
    { domain },
    { isdeleted: true },
    { new: true },
  );

  // Step 4: Return a success response with the deleted company details.
  return res
    .status(200)
    .json(new ApiResponse(200, deletedCompany, 'Company record deleted successfully'));
});

/**
 * getCompany
 * --------------------------------------------
 * Steps to get all active (non-deleted) companies:
 *   1. Fetch all companies from the database where isdeleted is false.
 *   2. Return the list of active companies.
 *
 * @route GET /api/v1/companies
 */
const getCompany = asyncHandler(async (req, res) => {
  // Step 1: Find all companies where isdeleted is false.
  const companyDetails = await Company.find({ isdeleted: false });

  // Step 2: Return the company details in the response.
  return res
    .status(200)
    .json(new ApiResponse(200, companyDetails, 'Company details fetched successfully'));
});

/**
 * getCompanyById
 * --------------------------------------------
 * Steps to get detailed company information by ID:
 *   1. Extract the company ID from the request parameters.
 *   2. Fetch the company details from the database using the ID.
 *   3. If the company is not found, throw a 404 error.
 *   4. Fetch all branch addresses associated with the company.
 *   5. Fetch all users associated with the company.
 *   6. For each branch address, fetch its associated dustbins.
 *   7. Construct a comprehensive response object containing the company details,
 *      branch addresses (with dustbins), and users.
 *   8. Return the full company details in the response.
 *
 * @route GET /api/v1/companies/:id
 */
const getCompanyById = asyncHandler(async (req, res) => {
  // Step 1: Extract the company ID from the URL parameters.
  const { id } = req.params;

  // Step 2: Fetch the company details using the ID.
  const company = await Company.findById(id);
  if (!company) {
    // Step 3: If company is not found, throw an error.
    throw new ApiError(404, 'Company not found');
  }

  // Step 4: Fetch branch addresses associated with this company.
  const branchAddresses = await BranchAddress.find({ associatedCompany: id });

  // Step 5: Fetch users associated with this company.
  const users = await User.find({ company: id }).populate({
    path: 'OrgUnit',
    select: 'name type branchAddress',
  });

  // Step 6: For each branch address, fetch associated dustbins and attach them.
  const branchesWithDustbins = await Promise.all(
    branchAddresses.map(async (branch) => {
      const dustbins = await Dustbin.find({ branchAddress: branch._id });
      return {
        ...branch.toObject(),
        dustbins, // Attach dustbins to the branch object
      };
    }),
  );

  // Step 7: Construct the comprehensive company details object.
  const companyDetails = {
    ...company.toObject(), // Convert Mongoose document to plain JavaScript object
    branchAddresses: branchesWithDustbins,
    users,
  };

  // Step 8: Return the full company details in the response.
  return res
    .status(200)
    .json(new ApiResponse(200, companyDetails, 'Company details fetched successfully'));
});

export { createNewCompany, updateCompanyDetails, deleteCompany, getCompany, getCompanyById };
