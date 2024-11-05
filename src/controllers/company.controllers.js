import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Company } from "../models/company.models.js";
import { BranchAddress } from "../models/branchAddress.models.js";
import { User } from "../models/user.models.js";


//create new company
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


//update company details
const updateCompanyDetails = asyncHandler(async (req, res) => {
    /*
    Steps to update company details:
    1. Get the details from the frontend
    2. Validate the required fields - if empty
    3. Check if the company already exists using the domain
    4. Update the company record in the DB
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
    if (!existedCompany) {          
        throw new ApiError(404, "Company not found");
    }

    // Update the company record in the DB  
    const updatedCompany = await Company.findOneAndUpdate(
        { domain },
        { CompanyName, domain, noofEmployees },
        { new: true }
    );  

    // Return success message along with the company details            
    return res.status(200).json(
        new ApiResponse(200, updatedCompany, "Company record updated successfully")
    );
}); 

//delete company by updating the isdeleted field
const deleteCompany = asyncHandler(async (req, res) => {
    const { domain } = req.body;
    const existedCompany = await Company.findOne({ domain });
    if (!existedCompany) {
        throw new ApiError(404, "Company not found");
    }
    const deletedCompany = await Company.findOneAndUpdate(
        { domain },
        { isdeleted: true },
        { new: true }
    );
    return res.status(200).json(
        new ApiResponse(200, deletedCompany, "Company record deleted successfully")
    );
});

//get company details
const getCompany = asyncHandler(async(req, res)=>{
    const companyDetails = await Company.find({isdeleted: false})
    return res.status(200).json(
        new ApiResponse(200, companyDetails, "Company details fetched successfully")
    )
})

// Controller function to get a company by its ID
const getCompanyById = asyncHandler(async (req, res) => {
    const { id } = req.params; // Extract the ID from the request parameters

    // Fetch the company details from the database using the ID
    const company = await Company.findById(id);

    // If the company is not found, throw a 404 error
    if (!company) {
        throw new ApiError(404, "Company not found");
    }

    // Fetch related branch addresses that reference this company
    const branchAddresses = await BranchAddress.find({ company: id });

    // Fetch related users that reference this company
    const users = await User.find({ company: id });

    // Construct the response object with company details, branch addresses, and users
    const companyDetails = {
        ...company.toObject(), // Convert the Mongoose document to a plain JavaScript object
        branchAddresses,
        users
    };

    // Return the full company details in the response
    return res.status(200).json(
        new ApiResponse(200, companyDetails, "Company details fetched successfully")
    );
});
// //get company's address using id in the params
// const getCompanyDetails = asyncHandler(async (req, res) => {
//     const { _id } = req.params;
//     const company = await Company.findById(_id)
//     if (!company) {
//         throw new ApiError(404, "Company not found");
//     }
//     return res.status(200).json(
//         new ApiResponse(200, company, "Company details fetched successfully")
//     )
// })



export { createNewCompany,
    updateCompanyDetails,
    deleteCompany,
    getCompany,
    getCompanyById
    //getCompanyDetails

 };
