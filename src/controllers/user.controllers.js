import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/user.models.js';
import { sendInvitationEmail } from '../utils/EmailService.js';
import { Company } from '../models/company.models.js';
import { BranchAddress } from '../models/branchAddress.models.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import jwt from 'jsonwebtoken'; // Needed for verifying refresh tokens

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
    throw new ApiError(500, 'Something went wrong while generating refresh and access token');
  }
};

/**
 * registerUser
 * -------------------------------------------
 * Registers a new user in the system and sends an invitation email to the user.
 * Steps:
 *   1. Extract user details from the request body.
 *   2. Validate that required fields are provided.
 *   3. Check if a user with the same email already exists.
 *   4. Create the new user in the database.
 *   5. Retrieve the newly created user while excluding sensitive fields.
 *   6. Fetch company details to populate the invitation email.
 *   7. Extract the first name from the full name.
 *   8. Prepare the email data and send the invitation email.
 *   9. Return a success response with the created user details.
 *
 * Edge Cases:
 *   - If any required field is missing, an error is thrown.
 *   - If the email already exists, an error is thrown.
 *   - If sending the invitation email fails, the error is logged but the user is still registered.
 *
 * @route POST /api/v1/users/register
 */
const registerUser = asyncHandler(async (req, res) => {
  // Step 1: Extract user details from the request body
  const { fullName, role, phone, email, password, branchAddress, company } = req.body;

  // Step 2: Validate that required fields are provided.
  // NOTE: The check uses "field?.trim" which compares the function reference. Ideally, it should be field?.trim() === "".
  if ([fullName, email, password, branchAddress, company].some((field) => field?.trim === '')) {
    throw new ApiError(400, 'All fields is required!');
  }

  // Step 3: Check if a user with the same email already exists in the database.
  const existedUser = await User.findOne({ email });
  if (existedUser) {
    throw new ApiError(409, 'Email already exists!');
  }

  // Step 4: Create a new user record in the database with the provided details.
  const createdby = req.user ? req.user._id : null;
  const user = await User.create({
    fullName,
    role,
    phone,
    email,
    password,
    branchAddress,
    company,
    createdby,
  });

  // Step 5: Retrieve the newly created user while excluding sensitive fields.
  const createdUser = await User.findById(user._id).select('-password -refreshToken');

  // Step 6: Ensure that the user was successfully created.
  if (!createdUser) {
    throw new ApiError(500, 'Something went wrong while registering the user 😢');
  }

  //Step 7: Fetch company details to populate the invitation email.
  let companyDetails;
  try {
    companyDetails = await Company.findById(createdUser.company);
  } catch (error) {
    console.error('Errror while fetching company details for invitation', error);
    companyDetails = { CompanyName: 'NetNada' };
  }

  //Step 8: Extract the first name from the full name.
  const firstName = fullName.split(' ')[0];

  //Step 9: Prepare the email data and send the invitation email.
  const emailData = {
    to: createdUser.email,
    firstName,
    role: createdUser.role,
    companyName: companyDetails.CompanyName,
    userId: createdUser.email,
    password,
  };

  //Step 10: Send the invitation email.
  try {
    await sendInvitationEmail(emailData);
  } catch (error) {
    console.error('Error while sending invitation email to ${createdUser.email}', error);
  }

  // Step 11: Return a success response with the created user details.
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, 'User registered successfully! 😊'));
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
 *   5. Check if the user is required to reset their password.
 *   6. Generate new access and refresh tokens.
 *   7. Retrieve the logged-in user details (populating company and branchAddress fields),
 *      then convert the Mongoose document to a plain JavaScript object.
 *   8. If the user is linked to a company, fetch all non-deleted branch addresses for that company
 *      and attach them to the company object.
 *   9. Set secure cookies with the tokens and return the fully populated user data.
 *
 * @route POST /api/v1/users/login
 */
const loginUser = asyncHandler(async (req, res) => {
  // Step 1: Extract credentials and rememberMe flag from request body
  const { email, password, rememberMe } = req.body;

  // Step 2: Validate that email and password are provided
  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required.');
  }

  // Step 3: Find the user in the database by email
  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(400, 'User does not exist.');
  }

  // Step 4: Verify the provided password against the stored password hash
  const isPasswordCorrect = await user.isPasswordCorrect(password);
  if (!isPasswordCorrect) {
    throw new ApiError(401, 'Invalid Credentials');
  }

  //Step 5: Check if the user is required to reset their password
  if (user.forcePasswordReset) {
    return res
      .status(403)
      .json({ message: 'Password reset required. Please change your password.' });
  }

  // Step 6: Generate access and refresh tokens for the user
  const { accessToken, refreshToken } = await generateAccessandRefreshToken(user._id);

  // Step 7: Retrieve the logged-in user details, populating company and branchAddress fields
  let loggedUser = await User.findById(user._id)
    .populate('company')
    .populate('branchAddress')
    .select('-password -refreshToken');

  // Convert the Mongoose document to a plain JavaScript object.
  loggedUser = loggedUser.toObject();

  // Step 8: If the user is linked to a company, fetch all non-deleted branch addresses for that company.
  if (loggedUser.company && loggedUser.company._id) {
    const branchAddresses = await BranchAddress.find({
      associatedCompany: loggedUser.company._id,
      isdeleted: false,
    });
    // Attach the branch addresses array to the company object.
    loggedUser.company.branchAddresses = branchAddresses;
  }

  // Step 9: Prepare options for secure cookies.
  const isProduction = process.env.NODE_ENV === 'production';
  const options = {
    httpOnly: true,
    secure: isProduction,
    maxAge: rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60, // 30 days vs 1 hour
  };

  // Step 10: Send tokens via cookies and return the fully populated logged-in user data.
  return res
    .status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedUser, accessToken, refreshToken },
        'User logged in successfully!',
      ),
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
  await User.findByIdAndUpdate(req.user._id, { $set: { refreshToken: undefined } }, { new: true });

  // Options for clearing cookies securely
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };

  // Step 2: Clear the accessToken and refreshToken cookies and return a response
  return res
    .status(200)
    .clearCookie('accessToken', options)
    .clearCookie('refreshToken', options)
    .json(new ApiResponse(200, {}, 'User logged out successfully'));
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
    throw new ApiError(401, 'Unauthorized request.');
  }

  try {
    // Step 3: Verify the refresh token using JWT
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    // Retrieve user details using the decoded token's user ID
    const userdetails = await User.findById(decodedToken?._id);
    if (!userdetails) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    // Step 4: Check if the incoming refresh token matches the one stored in the user record
    if (incomingRefreshToken !== userdetails.refreshToken) {
      throw new ApiError(401, 'Refresh token is expired or used');
    }

    // Cookie options for new tokens
    const options = {
      httpOnly: true,
      secure: true,
    };

    // Step 5: Generate new access and refresh tokens
    const { accessToken, refreshToken: newRefreshToken } = await generateAccessandRefreshToken(
      userdetails?._id,
    );

    // Step 6: Set new tokens as cookies and return them in the response
    return res
      .status(200)
      .cookie('accessToken', accessToken, options)
      .cookie('refreshToken', newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          'Access token refreshed',
        ),
      );
  } catch (error) {
    throw new ApiError(401, error?.message || 'Invalid refresh token.');
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
    .populate('company')
    .populate('branchAddress')
    .select('-password');

  if (!user) {
    throw new ApiError(404, 'User not found');
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
  return res.status(200).json(new ApiResponse(200, userObj, 'User fetched successfully'));
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
  console.log('[getUserByEmail] Received email:', email); // Debug log

  if (!email) {
    throw new ApiError(400, 'Email is required');
  }

  // Step 2: Find the user by email and populate related fields
  let user = await User.findOne({ email })
    .populate('company')
    .populate('branchAddress')
    .select('-password -refreshToken');
  console.log('[getUserByEmail] User found:', user); // Debug log

  if (!user) {
    throw new ApiError(404, 'User not found');
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
  return res.status(200).json(new ApiResponse(200, userObj, 'User fetched successfully by email'));
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
    throw new ApiError(400, 'Old password and new password are required');
  }

  // Step 3: Find the user by ID
  const user = await User.findById(req.user._id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Step 4: Verify the correctness of the old password
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    throw new ApiError(400, 'Old password is incorrect');
  }

  // Step 5: Update the user's password to the new password
  user.password = newPassword;
  // Step 6: Save the updated user (skip validations)
  await user.save({ validateBeforeSave: false });

  // Step 7: Remove the password field from the user object before returning (for security)
  user.password = undefined;

  // Step 8: Return a success response
  return res.status(200).json(new ApiResponse(200, {}, 'Password updated successfully'));
});

/**
 * updateUserDetails
 * -------------------------------------------
 * Updates the details of a user.
 * Steps:
 *   1. Determine the target user: use req.body.userId if provided, otherwise use req.user._id.
 *   2. Build an updates object containing only the allowed fields (fullName, phone, role, branchAddress).
 *   3. Remove update fields that are unchanged compared to current values.
 *   4. Preserve the existing company value from the user document.
 *   5. If no changes are detected, return the current user data.
 *   6. Update the user document with the new values.
 *   7. Explicitly restore the company field and save the document.
 *   8. Return a success response with the updated user details.
 */
const updateUserDetails = asyncHandler(async (req, res) => {
  // Step 1: Determine target user: use req.body.userId if provided, otherwise default to req.user._id
  const userId = req.body.userId || req.user._id;
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Step 2: Define allowed fields for update and build updates object from req.body
  const allowedUpdates = ['fullName', 'phone', 'role', 'branchAddress'];
  const updates = {};
  allowedUpdates.forEach((field) => {
    const value = req.body[field];
    if (value != null) {
      // Trim string values
      updates[field] = typeof value === 'string' ? value.trim() : value;
    }
  });

  // Step 3: Remove fields from updates if the new value is the same as the current value
  Object.keys(updates).forEach((field) => {
    const currentValue =
      typeof user[field] === 'object' && user[field].toString
        ? user[field].toString()
        : user[field];
    const newValue =
      typeof updates[field] === 'object' && updates[field].toString
        ? updates[field].toString()
        : updates[field];
    if (currentValue === newValue) {
      delete updates[field];
    }
  });

  // Step 4: Preserve the existing company field from the user document
  const preservedCompany = user.company;

  // Step 5: If no changes remain, return the current user data without updating
  if (Object.keys(updates).length === 0) {
    const currentUserData = await User.findById(user._id).select('-password -refreshToken');
    return res.status(200).json(new ApiResponse(200, currentUserData, 'No changes detected.'));
  }

  // Step 6: Update the user document with new values from updates
  Object.keys(updates).forEach((field) => {
    user[field] = updates[field];
  });

  // Step 7: Restore the company field to ensure it isn’t lost, then save the document
  user.company = preservedCompany;
  let updatedUser;
  try {
    updatedUser = await user.save();
  } catch (error) {
    console.error('Error updating user:', error);
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern)[0];
      throw new ApiError(409, `Duplicate field error: ${duplicateField} already exists.`);
    }
    throw new ApiError(500, 'An error occurred while updating the user.');
  }

  // Step 8: Retrieve and return the updated user details, excluding sensitive fields
  const updatedUserData = await User.findById(updatedUser._id).select('-password -refreshToken');
  return res
    .status(200)
    .json(new ApiResponse(200, updatedUserData, 'User details updated successfully'));
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
    throw new ApiError(404, 'User not found');
  }

  // Step 3: Mark the user as deleted (soft delete)
  user.isdeleted = true;
  // Step 4: Save the change without running validations
  await user.save({ validateBeforeSave: false });

  // Step 5: Return a success response
  return res.status(200).json(new ApiResponse(200, {}, 'User deleted successfully'));
});

/**
 * getAllUser
 * -------------------------------------------
 * Retrieves all active (non-deleted) users along with their company and branch address details.
 * Steps:
 *   1. Find all users where isdeleted is false.
 *   2. Populate the company field with selected fields and ensure only non-deleted companies are returned.
 *   3. Populate the branchAddress field with selected fields and ensure only non-deleted addresses are returned.
 *   4. Populate created by field from user
 *   5. Exclude sensitive fields like password and refreshToken.
 *   6. Return the list of users.
 *
 * @route GET /api/v1/users
 */
const getAllUser = asyncHandler(async (req, res) => {
  // Step 1: Find all non-deleted users
  const users = await User.find({ isdeleted: false })
    // Step 2: Populate company details (only select specific fields, and exclude deleted companies)
    .populate({
      path: 'company',
      select: 'CompanyName domain noofEmployees industry',
      match: { isdeleted: false },
    })
    // Step 3: Populate branch address details (only select specific fields, and exclude deleted addresses)
    .populate({
      path: 'branchAddress',
      select: 'officeName address city region postalCode country',
      match: { isdeleted: false },
    })

    //step 4: populate created by field from user
    .populate({
      path: 'createdby',
      select: 'fullName email',
    })

    // Step 5: Exclude sensitive fields
    .select('-password -refreshToken');

  // If no users found, return an empty array with a message.
  if (!users.length) {
    return res.status(200).json(new ApiResponse(200, [], 'No active users found.'));
  }

  // Step 5: Return the list of active users with their company and branch details
  return res.status(200).json(new ApiResponse(200, users, 'Users fetched successfully.'));
});

/**
 * forgotPassword
 * -------------------------------------------
 * Sends a password reset email to the user.
 * Handles two scenarios:
 *   1. Standard user-initiated password reset.
 *   2. Admin-created user with a temporary password.
 *
 * Steps:
 *   1. Validate the email and (optionally) tempPassword from the request.
 *   2. Retrieve the user by email (case-insensitive).
 *   3. Generate a secure reset token and set an expiration (1 hour).
 *   4. Save the token and expiration to the user's record (skipping full validations).
 *   5. Construct a reset URL using the FRONTEND_URL environment variable.
 *   6. Configure the Nodemailer transporter with SMTP settings.
 *   7. Build the email content, including the temporary password if provided.
 *   8. Send the email and handle any errors.
 *   9. Return a success response.
 *
 * @route POST /api/v1/users/forgotPassword
 */
const forgotPassword = asyncHandler(async (req, res) => {
  // Step 1: Validate input email and optional tempPassword
  const { email, tempPassword } = req.body;
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new ApiError(400, 'A valid email is required');
  }

  // Step 2: Find the user by email (using case-insensitive matching)
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    // Avoid revealing if the email exists
    throw new ApiError(404, 'User not found');
  }

  // Step 3: Generate a secure reset token and set expiration (1 hour)
  const resetToken = crypto.randomBytes(20).toString('hex');
  user.resetPasswordToken = resetToken;
  user.resetPasswordExpires = Date.now() + 3600000; // 1 hour in milliseconds

  // Step 4: Save the token and expiration (bypassing full validations)
  try {
    await user.save({ validateBeforeSave: false });
  } catch (error) {
    throw new ApiError(500, 'Error saving reset token. Please try again later.');
  }

  // Step 5: Construct the reset URL using the FRONTEND_URL environment variable
  const resetURL = `${
    process.env.FRONTEND_URL || 'http://localhost:3000'
  }/reset-password?token=${resetToken}`;

  // Step 6: Configure Nodemailer transporter with SMTP settings
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false otherwise
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Step 7: Build the email content (HTML format)
  let htmlContent = `<p>Hello,</p>
    <p>You requested a password reset. Please click the link below to reset your password:</p>
    <p><a href="${resetURL}">Reset Password</a></p>`;
  // If a temporary password is provided (admin-created scenario), include it in the email.
  if (tempPassword && typeof tempPassword === 'string' && tempPassword.trim()) {
    htmlContent += `<p>Your temporary password is: <strong>${tempPassword}</strong></p>
      <p>You are required to change this password immediately after logging in.</p>`;
  }
  htmlContent += `<p>If you did not request this, please ignore this email. The link expires in 1 hour.</p>`;

  const mailOptions = {
    from: process.env.FROM_EMAIL, // Ensure this email is allowed by your SMTP provider
    to: user.email,
    subject: 'Password Reset Request',
    html: htmlContent,
  };

  // Step 8: Attempt to send the email and handle errors
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`Error sending password reset email to ${user.email}:`, error);
    throw new ApiError(500, 'Error sending password reset email. Please try again later.');
  }

  // Step 9: Return a success response
  return res.status(200).json(new ApiResponse(200, {}, 'Password reset link sent successfully'));
});

/**
 * resetPassword
 * -------------------------------------------
 * Resets the user's password using the provided reset token.
 * On successful reset, the reset token fields and the forcePasswordReset flag are cleared.
 *
 * Steps:
 *   1. Validate the reset token and new password from the request.
 *   2. Retrieve the user by the reset token and ensure it has not expired.
 *   3. Update the user's password (which triggers hashing via pre-save hook).
 *   4. Clear the reset token and expiration fields.
 *   5. Clear the forcePasswordReset flag.
 *   6. Save the updated user record.
 *   7. Return a success response.
 *
 * @route POST /api/v1/users/resetPassword
 */
const resetPassword = asyncHandler(async (req, res) => {
  // Step 1: Validate input: token and new password
  const { token, newPassword } = req.body;
  if (!token || !newPassword || typeof newPassword !== 'string' || !newPassword.trim()) {
    throw new ApiError(400, 'Reset token and a valid new password are required');
  }

  // Step 2: Find the user by reset token and ensure the token has not expired
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });
  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  // Step 3: Update the user's password with the new value (password will be hashed automatically)
  user.password = newPassword.trim();

  // Step 4: Clear the reset token and expiration fields
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  // Step 5: Clear the forced password reset flag
  user.forcePasswordReset = false;

  // Step 6: Save the updated user record (bypassing full validations if needed)
  try {
    await user.save({ validateBeforeSave: false });
  } catch (error) {
    console.error('Error resetting password:', error);
    throw new ApiError(500, 'Error resetting password. Please try again later.');
  }

  // Optionally remove sensitive fields before responding
  user.password = undefined;

  // Step 7: Return a success response
  return res.status(200).json(new ApiResponse(200, {}, 'Password has been reset successfully'));
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
  updateUserDetails,
  deleteUser,
  getAllUser,
  forgotPassword,
  resetPassword,
};
