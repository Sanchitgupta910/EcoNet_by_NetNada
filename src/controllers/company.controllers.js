import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Company } from "../models/company.models.js";

const createNewCompany = asyncHandler(async (req, res) => {
    /*
    Steps to create a new company:
    1. Get the details from the frontend
    2. Validate the required fields - if empty
    3. Check if the company already exists using the domain
    4. Create a company object and store it in the DB
    5. Ensure the entry is created
    6. Send success or error response
    */
    
    const { CompanyName, domain, noofEmployees } = req.body;

    // Validate if required fields are empty
    if ([CompanyName, domain].some((field) => !field || field.trim === "")) {
        throw new ApiError(400, "Company name and domain are required!");
    }

    // Check if the company already exists in the DB using the domain
    const existedCompany = await Company.findOne({ domain });
    if (existedCompany) {
        throw new ApiError(409, "Company already exists");
    }

    // Create a new entry in the DB
    const companyRecord = await Company.create({
        CompanyName,
        domain,
        noofEmployees,
    });
    console.log(companyRecord)

    // Return success message along with the company details
    return res.status(201).json(
        new ApiResponse(201, companyRecord, "Company record created successfully")
    );
});

export { createNewCompany };
