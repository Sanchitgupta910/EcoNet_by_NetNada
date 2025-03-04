import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.models.js";
import { BranchAddress } from "../models/branchAddress.models.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken"; // Needed for verifying refresh tokens

/**
 * generateAccessandRefreshToken
 * -------------------------------------------
 * Generates an access token and a refresh token for the given user ID.
 * Steps:
 *   1. Find the user by the provided userID.
 *   2. Generate an access token and a refresh token using the user's methods.
 *   3. Save the newly generated refresh token in the user's record (bypassing validations).
 *   4. Return both tokens.
 *
 * @param {string} userID - The ID of the user for whom tokens are generated.
 * @returns {Object} An object containing the accessToken and refreshToken.
 * @throws {ApiError} If any error occurs during token generation.
 */
const generateAccessandRefreshToken = async (userID) => {
  try {
    // Step 1: Find the user by userID
    const user = await User.findById(userID);

    // Step 2: Generate access and refresh tokens for the user using model methods
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Step 3: Save the new refresh token to the user record (without running validations)
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    // Step 4: Return the generated tokens
    return { accessToken, refreshToken };
  } catch (error) {
    // If any error occurs, throw an ApiError with status code 500.
    throw new ApiError(
      500,
      "Something went wrong while generating refresh and access token"
    );
  }
};

/**
 * registerUser
 * -------------------------------------------
 * Registers a new user in the system.
 * Steps:
 *   1. Extract user details from the request body.
 *   2. Validate that required fields are not empty.
 *   3. Check if a user with the same email already exists.
 *   4. Create the new user in the database.
 *   5. Remove sensitive fields (password and refreshToken) from the returned user object.
 *   6. Ensure the user was created successfully.
 *   7. Return a success response with the created user details.
 *
 * @route POST /api/v1/users/register
 */
const registerUser = asyncHandler(async (req, res) => {
  // Step 1: Extract user details from the request body
  const { fullName, role, phone, email, password, branchAddress, company } = req.body;

  // Step 2: Validate that required fields are provided.
  // NOTE: The check uses "field?.trim" which compares the function reference. Ideally, it should be field?.trim() === "".
  if ([fullName, email, password, branchAddress, company].some((field) => field?.trim === "")) {
    throw new ApiError(400, "All fields is required!");
  }

  // Step 3: Check if a user with the same email already exists in the database.
  const existedUser = await User.findOne({ email });
  if (existedUser) {
    throw new ApiError(409, "Email already exists!");
  }

  // Step 4: Create a new user record in the database with the provided details.
  const user = await User.create({
    fullName,
    role,
    phone,
    email,
    password,
    branchAddress,
    company,
  });

  // Step 5: Retrieve the newly created user while excluding sensitive fields.
  const createdUser = await User.findById(user._id).select("-password -refreshToken");

  // Step 6: Ensure that the user was successfully created.
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user 😢");
  }

  // Step 7: Return a success response with the created user details.
  return res.status(201).json(
    new ApiResponse(200, createdUser, "User registered successfully! 😊")
  );
});

/**
 * loginUser
 * -------------------------------------------
 * Authenticates a user and logs them in.
 * Steps:
 *   1. Extract email, password, and rememberMe from the request body.
 *   2. Validate that both email and password are provided.
 *   3. Find the user by email.
 *   4. Verify that the provided password is correct.
 *   5. Generate new access and refresh tokens.
 *   6. Retrieve the logged-in user details (populating company and branchAddress fields),
 *      then convert the Mongoose document to a plain JavaScript object.
 *   7. If the user is linked to a company, fetch all non-deleted branch addresses for that company
 *      and attach them to the company object.
 *   8. Set secure cookies with the tokens and return the fully populated user data.
 *
 * @route POST /api/v1/users/login
 */
const loginUser = asyncHandler(async (req, res) => {
  // Step 1: Extract credentials and rememberMe flag from request body
  const { email, password, rememberMe } = req.body;

  // Step 2: Validate that email and password are provided
  if (!email || !password) {
    throw new ApiError(400, "Email and password are required.");
  }

  // Step 3: Find the user in the database by email
  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(400, "User does not exist.");
  }

  // Step 4: Verify the provided password against the stored password hash
  const isPasswordCorrect = await user.isPasswordCorrect(password);
  if (!isPasswordCorrect) {
    throw new ApiError(401, "Invalid Credentials");
  }

  // Step 5: Generate access and refresh tokens for the user
  const { accessToken, refreshToken } = await generateAccessandRefreshToken(user._id);

  // Step 6: Retrieve the logged-in user details, populating company and branchAddress fields
  let loggedUser = await User.findById(user._id)
    .populate("company")
    .populate("branchAddress")
    .select("-password -refreshToken");

  // Convert the Mongoose document to a plain JavaScript object.
  loggedUser = loggedUser.toObject();

  // Step 7: If the user is linked to a company, fetch all non-deleted branch addresses for that company.
  if (loggedUser.company && loggedUser.company._id) {
    const branchAddresses = await BranchAddress.find({
      associatedCompany: loggedUser.company._id,
      isdeleted: false,
    });
    // Attach the branch addresses array to the company object.
    loggedUser.company.branchAddresses = branchAddresses;
  }

  // Step 8: Prepare options for secure cookies.
  const isProduction = process.env.NODE_ENV === "production";
  const options = {
    httpOnly: true,
    secure: isProduction,
    maxAge: rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60, // 30 days vs 1 hour
  };

  // Step 9: Send tokens via cookies and return the fully populated logged-in user data.
  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedUser, accessToken, refreshToken },
        "User logged in successfully!"
      )
    );
});


/**
 * logoutUser
 * -------------------------------------------
 * Logs out the current user.
 * Steps:
 *   1. Remove the refresh token from the user's record in the database.
 *   2. Clear the accessToken and refreshToken cookies.
 *   3. Return a success response.
 *
 * @route POST /api/v1/users/logout
 */
const logoutUser = asyncHandler(async (req, res) => {
  // Step 1: Remove the refresh token from the user's record in the database
  await User.findByIdAndUpdate(
    req.user._id,
    { $set: { refreshToken: undefined } },
    { new: true }
  );

  // Options for clearing cookies securely
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };

  // Step 2: Clear the accessToken and refreshToken cookies and return a response
  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

/**
 * refreshAccessToken
 * -------------------------------------------
 * Refreshes the access token using the provided refresh token.
 * Steps:
 *   1. Retrieve the incoming refresh token from the cookies.
 *   2. Verify that the refresh token exists; if not, throw an unauthorized error.
 *   3. Verify the refresh token using JWT and retrieve the associated user ID.
 *   4. Check if the user exists and that the token matches the stored token.
 *   5. Generate new tokens and set them as cookies.
 *   6. Return the new access token and refresh token.
 *
 * @route POST /api/v1/users/refresh
 */
const refreshAccessToken = asyncHandler(async (req, res) => {
  // Step 1: Retrieve refresh token from cookies (assuming cookie parsing middleware is in place)
  const incomingRefreshToken = req.cookie?.refreshToken;

  // Step 2: Validate that the refresh token exists
  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request.");
  }

  try {
    // Step 3: Verify the refresh token using JWT
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    // Retrieve user details using the decoded token's user ID
    const userdetails = await User.findById(decodedToken?._id);
    if (!userdetails) {
      throw new ApiError(401, "Invalid refresh token");
    }

    // Step 4: Check if the incoming refresh token matches the one stored in the user record
    if (incomingRefreshToken !== userdetails.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used");
    }

    // Cookie options for new tokens
    const options = {
      httpOnly: true,
      secure: true,
    };

    // Step 5: Generate new access and refresh tokens
    const { accessToken, refreshToken: newRefreshToken } = await generateAccessandRefreshToken(userdetails?._id);

    // Step 6: Set new tokens as cookies and return them in the response
    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access token refreshed"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token.");
  }
});

/**
 * getCurrentUser
 * -------------------------------------------
 * Fetches the current user's details, excluding the password, and populates related fields.
 * Steps:
 *   1. Find the user by ID and populate the 'company' and 'branchAddress' fields.
 *   2. If the user is linked to a company, fetch all branch addresses associated with that company.
 *   3. Attach the branch addresses to the company object.
 *   4. Return the user object.
 *
 * @route GET /api/v1/users/me
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  // Step 1: Find the user and populate company and branchAddress; exclude the password field.
  let user = await User.findById(req.user._id)
    .populate("company")
    .populate("branchAddress")
    .select("-password");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Convert Mongoose document to a plain JS object for further modifications
  const userObj = user.toObject();

  // Step 2: If the user is linked to a company, fetch all non-deleted branch addresses
  if (userObj.company && userObj.company._id) {
    const branchAddresses = await BranchAddress.find({
      associatedCompany: userObj.company._id,
      isdeleted: false,
    });
    // Step 3: Attach branch addresses to the company object
    userObj.company.branchAddresses = branchAddresses;
  }

  // Step 4: Return the user data
  return res.status(200).json(new ApiResponse(200, userObj, "User fetched successfully"));
});

/**
 * getUserByEmail
 * -------------------------------------------
 * Fetches a user's details by email, excluding the password, and populates related fields.
 * Steps:
 *   1. Extract the email from the query parameters.
 *   2. Validate that the email is provided.
 *   3. Find the user by email and populate the 'company' and 'branchAddress' fields.
 *   4. If the user is linked to a company, fetch all branch addresses associated with that company.
 *   5. Attach the branch addresses to the company object.
 *   6. Return the user object.
 *
 * @route GET /api/v1/users/byEmail
 */
const getUserByEmail = asyncHandler(async (req, res) => {
  // Step 1: Extract email from query parameters
  const { email } = req.query;
  console.log("[getUserByEmail] Received email:", email); // Debug log

  if (!email) {
    throw new ApiError(400, "Email is required");
  }

  // Step 2: Find the user by email and populate related fields
  let user = await User.findOne({ email })
    .populate("company")
    .populate("branchAddress")
    .select("-password -refreshToken");
  console.log("[getUserByEmail] User found:", user); // Debug log

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Step 3: Convert document to plain JS object
  const userObj = user.toObject();

  // Step 4: If the user is linked to a company, fetch all non-deleted branch addresses
  if (userObj.company && userObj.company._id) {
    const branchAddresses = await BranchAddress.find({
      associatedCompany: userObj.company._id,
      isdeleted: false,
    });
    // Attach branch addresses to the company object
    userObj.company.branchAddresses = branchAddresses;
  }

  // Step 5: Return the fetched user data
  return res.status(200).json(new ApiResponse(200, userObj, "User fetched successfully by email"));
});

/**
 * updateUserPassword
 * -------------------------------------------
 * Updates the current user's password.
 * Steps:
 *   1. Extract oldPassword and newPassword from the request body.
 *   2. Validate that both are provided.
 *   3. Find the user by ID.
 *   4. Verify that the old password is correct.
 *   5. Update the user's password with the new one.
 *   6. Save the user (without triggering validations).
 *   7. Remove the password field from the response.
 *   8. Return a success message.
 *
 * @route PATCH /api/v1/users/updatePassword
 */
const updateUserPassword = asyncHandler(async (req, res) => {
  // Step 1: Extract old and new passwords from request body
  const { oldPassword, newPassword } = req.body;
  // Step 2: Validate that both passwords are provided
  if (!oldPassword || !newPassword) {
    throw new ApiError(400, "Old password and new password are required");
  }

  // Step 3: Find the user by ID
  const user = await User.findById(req.user._id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Step 4: Verify the correctness of the old password
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    throw new ApiError(400, "Old password is incorrect");
  }

  // Step 5: Update the user's password to the new password
  user.password = newPassword;
  // Step 6: Save the updated user (skip validations)
  await user.save({ validateBeforeSave: false });

  // Step 7: Remove the password field from the user object before returning (for security)
  user.password = undefined;

  // Step 8: Return a success response
  return res.status(200).json(new ApiResponse(200, {}, "Password updated successfully"));
});

/**
 * deleteUser
 * -------------------------------------------
 * Marks a user as deleted (soft delete) by setting the 'isdeleted' flag to true.
 * Steps:
 *   1. Extract the userId from the request body.
 *   2. Find the user by the given userId.
 *   3. If the user exists, mark the user as deleted.
 *   4. Save the user record (without validations).
 *   5. Return a success response.
 *
 * @route DELETE /api/v1/users/delete
 */
const deleteUser = asyncHandler(async (req, res) => {
  // Step 1: Retrieve the userId from the request body
  const { userId } = req.body;

  // Step 2: Find the user by ID
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Step 3: Mark the user as deleted (soft delete)
  user.isdeleted = true;
  // Step 4: Save the change without running validations
  await user.save({ validateBeforeSave: false });

  // Step 5: Return a success response
  return res.status(200).json(new ApiResponse(200, {}, "User deleted successfully"));
});

/**
 * getAllUser
 * -------------------------------------------
 * Retrieves all active (non-deleted) users along with their company and branch address details.
 * Steps:
 *   1. Find all users where isdeleted is false.
 *   2. Populate the company field with selected fields and ensure only non-deleted companies are returned.
 *   3. Populate the branchAddress field with selected fields and ensure only non-deleted addresses are returned.
 *   4. Exclude sensitive fields like password and refreshToken.
 *   5. Return the list of users.
 *
 * @route GET /api/v1/users
 */
const getAllUser = asyncHandler(async (req, res) => {
  // Step 1: Find all non-deleted users
  const users = await User.find({ isdeleted: false })
    // Step 2: Populate company details (only select specific fields, and exclude deleted companies)
    .populate({
      path: "company",
      select: "CompanyName domain noofEmployees",
      match: { isdeleted: false },
    })
    // Step 3: Populate branch address details (only select specific fields, and exclude deleted addresses)
    .populate({
      path: "branchAddress",
      select: "officeName address city region postalCode country",
      match: { isdeleted: false },
    })
    // Step 4: Exclude sensitive fields
    .select("-password -refreshToken");

  // If no users found, return an empty array with a message.
  if (!users.length) {
    return res.status(200).json(new ApiResponse(200, [], "No active users found."));
  }

  // Step 5: Return the list of active users with their company and branch details
  return res.status(200).json(new ApiResponse(200, users, "Users fetched successfully."));
});

// Export all user-related controllers
export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  getUserByEmail,
  updateUserPassword,
  deleteUser,
  getAllUser,
};
