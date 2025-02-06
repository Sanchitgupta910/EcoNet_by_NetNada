import {asyncHandler} from "../utils/asyncHandler.js"
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.models.js"
import { BranchAddress } from "../models/branchAddress.models.js"
import { ApiResponse } from "../utils/ApiResponse.js"
 
// Function to generate access and refresh tokens based on user ID
const generateAccessandRefreshToken = async (userID) =>  
{
    try {
        // Find user by userID
        const user = await User.findById(userID)
        
        // // Generate access token and refresh token for the user
        const accessToken= user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        
        // Save the new refresh token to the user and avoid validation on other fields
        user.refreshToken= refreshToken
        await user.save({ validateBeforeSave : false})

        // Return the generated tokens
        return {accessToken, refreshToken}
        

    } catch (error) {
        
        // If something goes wrong, throw an error
        throw new ApiError(500, "Something went wrong while generating refresh and access token")
    }
}

// Register new user
const registerUser = asyncHandler( async (req, res) => {

    /*
    Steps to register a user:

    1. Get user details from the frontend
    2. Validate the input details (check for empty fields)
    3. Check if the user already exists (using email)
    4. Create user object and store it in the database
    5. Remove password and refresh token fields from the response
    6. Ensure user creation is successful
    7. Return the success response
    */

    // Step 2: Extract user details from request body
    const {fullName, role, phone, email, password, branchAddress, company} = req.body

    // Validate if required fields are empty
    if (
        [fullName, email, password, branchAddress, company].some((field) => field?.trim === "")
    )
    {
        throw new ApiError(400, "All fields is required!")
    }

    // Step 3: Check if a user with the same email already exists
    const existedUser = await User.findOne({email})

    if (existedUser) {
        throw new ApiError(409, "Email already exists!")
    }

    // Step 4: Create a new user entry in the database
    const user = await User.create({
        fullName,
        role,
        phone,
        email,
        password,
        branchAddress,
        company
    })

    // Step 5: Remove password and refreshToken from the response
    const createdUser = await User.findById(user._id).select("-password -refreshToken")

    // Step 6: Ensure that the user was created successfully
    if(!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user 😢")
    }

    // Step 7: Return success response along with created user details
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully! 😊")
    )

})

// Login user
const loginUser = asyncHandler(async (req, res) => {

    /*
    Steps to login a user:

    1. Take email and password from the user
    2. Validate the given info
    3. Check if the user is registered
    4. If registered, decrypt the password and compare it
    5. Generate access and refresh tokens
    6. Send tokens to the user as secured cookies
    */

    // Step 1: Get email and password from request body
    const {email, password, rememberMe } = req.body

    // Step 2: Validate that email is provided
    if(!email || !password){
        throw new ApiError(400, "Email and password are required.")
    }

    // Step 3: Find user by email
    const user = await User.findOne({email})

    if(!user){
        throw new ApiError (400, "User does not exist.")
    }

    // Step 4: Verify password
    const isPasswordCorrect = await user.isPasswordCorrect(password)
    if(!isPasswordCorrect){
        throw new ApiError (401, "Invalid Credentials")
    }

    // Step 5: Generate access and refresh tokens
    const {accessToken, refreshToken} = await generateAccessandRefreshToken(user._id)

    // Exclude password and refreshToken from the logged-in user's response
    const loggedUser = await User.findById(user._id).select("-password -refreshToken")

    // Set options for secure cookies
    const isProduction = process.env.NODE_ENV === "production";
    const options = {
        httpOnly : true,
        secure : isProduction,
        maxAge: rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60
    }

    // Step 6: Send tokens and logged-in user data in the response
    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200, 
            {
                user: loggedUser, accessToken, refreshToken
            },
            "User logged in successfully!"
        )
    )

})

// Logout user
const logoutUser = asyncHandler(async(req, res) => {

    // Remove refresh token from the user's record in the database
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set:{
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    // Options for clearing cookies securely
    const options = {
        httpOnly : true,
        secure : process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/"
    };

    // Clear accessToken and refreshToken cookies
    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(
        new ApiResponse(200, {}, "User logged out successfully")
    )

})

//refreshing access token
const refreshAccessToken = asyncHandler ( async(req, res) => {
    const incomingRefreshToken = req.cookie?.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401, "Unauthorized request.")
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken, 
            process.env.REFRESH_TOKEN_SECRET
        )
    
        const userdetails = await User.findById(decodedToken?._id)
        if(!userdetails){
            throw new ApiError(401, "Invalid refresh token")
        }
    
        if(incomingRefreshToken !== userdetails){
            throw new ApiError(401, "Refresh token is expired or used")
        }
    
        const options ={
            httpOnly: true,
            secure: true
        }
    
        const {accessToken,newRefreshToken } = await generateAccessandRefreshToken(userdetails?._id)
    
        return res
        .status(200)
        .cookie("accessToken",accessToken, options)
        .cookie("refreshToken",newRefreshToken, options)
        .json(
            new ApiResponse(
                200,
                {accessToken, refreshToken: newRefreshToken},
                "Access token refreshed"
            )
        )
    
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token.")
    }

})


/**
 * getCurrentUser
 * Fetches the current user (excluding the password) and attempts to populate
 * the company and branchAddress fields. Additionally, if the user is linked to a company,
 * it fetches all branch addresses associated with that company and attaches them
 * to the company object.
 *
 * If the user is not linked to any company (e.g., superadmin created before a company was set up),
 * then no branch addresses are fetched.
 */ 
const getCurrentUser = asyncHandler(async (req, res) => {
    // Find the user by ID, populate the 'company' and 'branchAddress' fields, and exclude the password.
    let user = await User.findById(req.user._id)
      .populate("company")
      .populate("branchAddress")
      .select("-password");
  
    if (!user) {
      throw new ApiError(404, "User not found");
    }
  
    // Convert the Mongoose document to a plain JavaScript object for modification.
    const userObj = user.toObject();
  
    // If the user is linked to a company, fetch all branch addresses for that company.
    if (userObj.company && userObj.company._id) {
      const branchAddresses = await BranchAddress.find({
        associatedCompany: userObj.company._id,
        isdeleted: false,
      });
      // Attach the branch addresses to the company object.
      userObj.company.branchAddresses = branchAddresses;
    }
  
    return res.status(200).json(
      new ApiResponse(200, userObj, "User fetched successfully")
    );
  });

//update user password /remove password from response
const updateUserPassword = asyncHandler(async(req, res) => {
    const { oldPassword, newPassword } = req.body
    if(!oldPassword || !newPassword){
        throw new ApiError(400, "Old password and new password are required")
    }
    const user = await User.findById(req.user._id)
    if(!user){
        throw new ApiError(404, "User not found")
    }
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)
    if(!isPasswordCorrect){
        throw new ApiError(400, "Old password is incorrect")
    }
    user.password = newPassword
    await user.save({validateBeforeSave: false})
    
    // Remove password from user object before sending the response
    user.password = undefined

    return res.status(200).json(
        new ApiResponse(200, {}, "Password updated successfully")
    )
})

//delete user using isdeleted
const deleteUser = asyncHandler(async (req, res) => {
    const { userId } = req.body; // Retrieve userId from the request body

    const user = await User.findById(userId); // Find the user by userId
    if (!user) {
        throw new ApiError(404, "User not found");
    }
    user.isdeleted = true; // Mark the user as deleted
    await user.save({ validateBeforeSave: false });

    return res.status(200).json(
        new ApiResponse(200, {}, "User deleted successfully")
    );
});



// Get all active users (excluding deleted users)
const getAllUser = asyncHandler(async (req, res) => {
    // Fetch all users where isdeleted is false, and populate company and branchAddress details
    const users = await User.find({ isdeleted: false })
        .populate({
            path: 'company',
            select: 'CompanyName domain noofEmployees', // Selecting specific fields from the Company model
            match: { isdeleted: false } // Exclude companies marked as deleted
        })
        .populate({
            path: 'branchAddress',
            select: 'branchName address city state postalCode country', // Selecting specific fields from the Address model
            match: { isdeleted: false } // Exclude branch addresses marked as deleted
        })
        .select('-password -refreshToken'); // Exclude sensitive fields

    // If no users are found, return an empty array
    if (!users.length) {
        return res.status(200).json(new ApiResponse(200, [], "No active users found."));
    }

    // Return the list of users with company and branch details
    return res.status(200).json(
        new ApiResponse(200, users, "Users fetched successfully.")
    );
});


// Export user-related controllers
export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    getCurrentUser,
    updateUserPassword,
    deleteUser,
    getAllUser
}
