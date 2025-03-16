import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/user.models.js';
import { sendInvitationEmail, sendCompleteRegistrationEmail } from '../utils/EmailService.js';
import { Company } from '../models/company.models.js';
import { Invitation } from '../models/invitation.models.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import crypto from 'crypto';
import jwt from 'jsonwebtoken'; // For verifying refresh tokens

dotenv.config({
  path: '../../.env',
});

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
 * @returns {Object} - An object containing the accessToken and refreshToken.
 * @throws {ApiError} - If any error occurs during token generation.
 */
const generateAccessandRefreshToken = async (userID) => {
  try {
    // Step 1: Find the user by userID.
    const user = await User.findById(userID);

    // Step 2: Generate access and refresh tokens using model methods.
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Step 3: Save the new refresh token to the user record (without triggering validations).
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    // Step 4: Return the generated tokens.
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(500, 'Something went wrong while generating refresh and access token');
  }
};

/**
 * registerUser
 * -------------------------------------------
 * Registers a new user (invite mode) and sends an invitation email.
 *
 * For invitations, if fullName or password are missing:
 *   - fullName defaults to "Invited User"
 *   - password is auto-generated as a temporary password.
 *
 * Required fields:
 *   - email, role, OrgUnit, company.
 *
 * The inviting admin's ID is saved in the 'createdby' field.
 *
 * @route POST /api/v1/users/register
 */
const registerUser = asyncHandler(async (req, res) => {
  // Extract fields from the request body.
  const { fullName, role, phone, email, password, OrgUnit, company } = req.body;

  // Validate minimal required fields.
  if (!email || !OrgUnit || !company || !role) {
    throw new ApiError(400, 'Email, role, OrgUnit, and company are required');
  }

  // Use defaults for fullName and password if not provided.
  const effectiveFullName = fullName && fullName.trim() ? fullName.trim() : 'Invited User';
  const effectivePassword =
    password && password.trim() ? password.trim() : crypto.randomBytes(8).toString('hex');

  // Check if the email already exists.
  const existedUser = await User.findOne({ email });
  if (existedUser) {
    throw new ApiError(409, 'Email already exists!');
  }

  // Use the authenticated user (from req.user) as the inviter.
  const createdby = req.user ? req.user._id : null;

  // Create the user.
  const user = await User.create({
    fullName: effectiveFullName,
    role,
    phone,
    email,
    password: effectivePassword,
    OrgUnit,
    company,
    createdby,
  });

  // Retrieve the newly created user without sensitive fields.
  const createdUser = await User.findById(user._id).select('-password -refreshToken');
  if (!createdUser) {
    throw new ApiError(500, 'Something went wrong while registering the user');
  }

  // Fetch company details (to include in the invitation email).
  let companyDetails;
  try {
    companyDetails = await Company.findById(createdUser.company);
  } catch (error) {
    console.error('Error fetching company details for invitation:', error);
    companyDetails = { CompanyName: 'NetNada' };
  }

  // Extract first name for email personalization.
  const firstName = effectiveFullName.split(' ')[0];

  // Prepare email data.
  const emailData = {
    to: createdUser.email,
    firstName,
    role: createdUser.role,
    companyName: companyDetails.CompanyName,
    userId: createdUser.email,
    password: effectivePassword,
  };

  try {
    // Send the invitation email.
    await sendInvitationEmail(emailData);
  } catch (error) {
    console.error(`Error sending invitation email to ${createdUser.email}:`, error);
  }

  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, 'User registered and invitation sent successfully!'));
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
 *   6. Generate access and refresh tokens.
 *   7. Retrieve the user details, populating company and OrgUnit fields.
 *   8. Set secure cookies with the tokens and return the user data.
 *
 * @route POST /api/v1/users/login
 */
const loginUser = asyncHandler(async (req, res) => {
  // Step 1: Extract credentials and rememberMe flag.
  const { email, password, rememberMe } = req.body;

  // Step 2: Validate that email and password are provided.
  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required.');
  }

  // Step 3: Find the user by email.
  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(400, 'User does not exist.');
  }

  // Step 4: Verify the provided password against the stored hash.
  const isPasswordCorrect = await user.isPasswordCorrect(password);
  if (!isPasswordCorrect) {
    throw new ApiError(401, 'Invalid Credentials');
  }

  // Step 5: Check if the user must reset their password.
  if (user.forcePasswordReset) {
    return res
      .status(403)
      .json({ message: 'Password reset required. Please change your password.' });
  }

  // Step 6: Generate access and refresh tokens.
  const { accessToken, refreshToken } = await generateAccessandRefreshToken(user._id);

  // Step 7: Retrieve user details, populating company and OrgUnit fields.
  // NOTE: Updated populate field to "OrgUnit" (matches schema) instead of "OrgUnit".
  let loggedUser = await User.findById(user._id)
    .populate('company')
    .populate({
      path: 'OrgUnit',
      populate: { path: 'branchAddress' }, // Populate branchAddress within OrgUnit
    })
    .select('-password -refreshToken');
  console.log('Logged User OrgUnit:', loggedUser.OrgUnit);
  loggedUser = loggedUser.toObject();

  // Step 8: Prepare secure cookie options.
  const isProduction = process.env.NODE_ENV === 'production';
  const options = {
    httpOnly: true,
    secure: isProduction,
    maxAge: rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60, // 30 days vs 1 hour
  };

  // Step 9: Set cookies and return the logged-in user data.
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
 * Logs out the current user by removing the refresh token and clearing cookies.
 * Steps:
 *   1. Remove the refresh token from the user's record.
 *   2. Clear the accessToken and refreshToken cookies.
 *   3. Return a success response.
 *
 * @route POST /api/v1/users/logout
 */
const logoutUser = asyncHandler(async (req, res) => {
  // Step 1: Remove the refresh token from the user's record.
  await User.findByIdAndUpdate(req.user._id, { $set: { refreshToken: undefined } }, { new: true });

  // Step 2: Prepare cookie options for clearing cookies securely.
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };

  // Step 3: Clear cookies and return a success response.
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
 *   1. Retrieve the incoming refresh token from cookies.
 *   2. Validate the refresh token; if missing, throw an error.
 *   3. Verify the token and retrieve the associated user ID.
 *   4. Ensure the token matches the one stored for the user.
 *   5. Generate new tokens, set cookies, and return them.
 *
 * @route POST /api/v1/users/refresh
 */
const refreshAccessToken = asyncHandler(async (req, res) => {
  // Step 1: Retrieve refresh token from cookies.
  const incomingRefreshToken = req.cookie?.refreshToken;
  if (!incomingRefreshToken) {
    throw new ApiError(401, 'Unauthorized request.');
  }

  try {
    // Step 2: Verify the refresh token using JWT.
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    // Step 3: Retrieve user details using the decoded token.
    const userdetails = await User.findById(decodedToken?._id);
    if (!userdetails) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    // Step 4: Check that the incoming refresh token matches the stored token.
    if (incomingRefreshToken !== userdetails.refreshToken) {
      throw new ApiError(401, 'Refresh token is expired or used');
    }

    // Step 5: Define cookie options for new tokens.
    const options = {
      httpOnly: true,
      secure: true,
    };

    // Step 6: Generate new access and refresh tokens.
    const { accessToken, refreshToken: newRefreshToken } = await generateAccessandRefreshToken(
      userdetails._id,
    );

    // Step 7: Set new tokens as cookies and return them.
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
 *   1. Find the user by ID and populate 'company' and 'OrgUnit' fields.
 *   2. Return the user object.
 *
 * @route GET /api/v1/users/me
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  let user = await User.findById(req.user._id)
    .populate('company')
    .populate({
      path: 'OrgUnit',
      populate: { path: 'branchAddress' }, // Populate branchAddress within OrgUnit
    })
    .select('-password');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  const userObj = user.toObject();
  return res.status(200).json(new ApiResponse(200, userObj, 'User fetched successfully'));
});

/**
 * getUserByEmail
 * -------------------------------------------
 * Fetches a user's details by email, excluding the password, and populates related fields.
 * Steps:
 *   1. Extract the email from query parameters.
 *   2. Validate that email is provided.
 *   3. Find the user by email and populate 'company' and 'OrgUnit' fields.
 *   4. Return the user object.
 *
 * @route GET /api/v1/users/byEmail
 */
const getUserByEmail = asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email) {
    throw new ApiError(400, 'Email is required');
  }
  let user = await User.findOne({ email })
    .populate('company')
    .populate({
      path: 'OrgUnit',
      populate: { path: 'branchAddress' },
    })
    .select('-password -refreshToken');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  const userObj = user.toObject();
  return res.status(200).json(new ApiResponse(200, userObj, 'User fetched successfully by email'));
});

/**
 * updateUserDetails
 * -------------------------------------------
 * Updates the details of a user.
 * Steps:
 *   1. Determine the target user (from req.body.userId or req.user._id).
 *   2. Build an updates object from allowed fields (fullName, phone, role, OrgUnit).
 *   3. Remove fields that have not changed.
 *   4. Preserve the existing company field.
 *   5. Update the user document and save.
 *   6. Return the updated user details.
 *
 * @route POST /api/v1/users/updateuser
 */
const updateUserDetails = asyncHandler(async (req, res) => {
  const userId = req.body.userId || req.user._id;
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  // Allowed fields updated to include OrgUnit.
  const allowedUpdates = ['fullName', 'phone', 'role', 'OrgUnit'];
  const updates = {};
  allowedUpdates.forEach((field) => {
    const value = req.body[field];
    if (value != null) {
      updates[field] = typeof value === 'string' ? value.trim() : value;
    }
  });
  // Remove fields from updates if the value has not changed.
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
  // Preserve the existing company field.
  const preservedCompany = user.company;
  if (Object.keys(updates).length === 0) {
    const currentUserData = await User.findById(user._id).select('-password -refreshToken');
    return res.status(200).json(new ApiResponse(200, currentUserData, 'No changes detected.'));
  }
  Object.keys(updates).forEach((field) => {
    user[field] = updates[field];
  });
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
  const updatedUserData = await User.findById(updatedUser._id).select('-password -refreshToken');
  return res
    .status(200)
    .json(new ApiResponse(200, updatedUserData, 'User details updated successfully'));
});

/**
 * deleteUser
 * -------------------------------------------
 * Soft-deletes a user by setting the 'isdeleted' flag to true.
 * Steps:
 *   1. Extract the userId from the request body.
 *   2. Find the user by ID.
 *   3. Mark the user as deleted.
 *   4. Save the user record (skipping validations).
 *   5. Return a success response.
 *
 * @route DELETE /api/v1/users/delete
 */
const deleteUser = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  user.isdeleted = true;
  await user.save({ validateBeforeSave: false });
  return res.status(200).json(new ApiResponse(200, {}, 'User deleted successfully'));
});

/**
 * getAllUser
 * -------------------------------------------
 * Retrieves all active (non-deleted) users with their company and OrgUnit details.
 * Steps:
 *   1. Find all users where isdeleted is false.
 *   2. Populate company and OrgUnit fields.
 *   3. Exclude sensitive fields and return the list.
 *
 * @route GET /api/v1/users
 */
const getAllUser = asyncHandler(async (req, res) => {
  const users = await User.find({ isdeleted: false })
    .populate({
      path: 'company',
      select: 'CompanyName domain noofEmployees industry',
      match: { isdeleted: false },
    })
    .populate({
      path: 'OrgUnit',
      select: 'name type parent',
    })
    .populate({
      path: 'createdby',
      select: 'fullName email',
    })
    .select('-password -refreshToken');

  if (!users.length) {
    return res.status(200).json(new ApiResponse(200, [], 'No active users found.'));
  }

  return res.status(200).json(new ApiResponse(200, users, 'Users fetched successfully.'));
});

/**
 * forgotPassword
 * -------------------------------------------
 * Sends a password reset email to the user.
 * Handles both standard user-initiated and admin-created (temporary password) scenarios.
 * Steps:
 *   1. Validate the email (and optional tempPassword) from the request.
 *   2. Find the user by email (case-insensitive).
 *   3. Generate a secure reset token and set an expiration (1 hour).
 *   4. Save the token and expiration in the user's record (skipping full validations).
 *   5. Construct a reset URL using the FRONTEND_URL environment variable.
 *   6. Configure the Nodemailer transporter with SMTP settings.
 *   7. Build the email content, including the temporary password if provided.
 *   8. Send the email and handle any errors.
 *   9. Return a success response.
 *
 * @route POST /api/v1/users/forgotPassword
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email, tempPassword } = req.body;
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new ApiError(400, 'A valid email is required');
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  const resetToken = crypto.randomBytes(20).toString('hex');
  user.resetPasswordToken = resetToken;
  user.resetPasswordExpires = Date.now() + 3600000; // 1 hour in milliseconds
  try {
    await user.save({ validateBeforeSave: false });
  } catch (error) {
    throw new ApiError(500, 'Error saving reset token. Please try again later.');
  }
  const resetURL = `${process.env.FRONTEND_URL}/password-reset?token=${resetToken}`;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true, // Enable connection pooling
    maxConnections: 5, // Adjust based on your needs
    maxMessages: 100, // Maximum messages per connection
    socketTimeout: 10000, // Increase socket timeout (in milliseconds)
  });
  let htmlContent = `<p>Hello,</p>
    <p>You requested a password reset. Please click the link below to reset your password:</p>
    <p><a href="${resetURL}">Reset Password</a></p>`;
  if (tempPassword && typeof tempPassword === 'string' && tempPassword.trim()) {
    htmlContent += `<p>Your temporary password is: <strong>${tempPassword}</strong></p>
      <p>You are required to change this password immediately after logging in.</p>`;
  }
  htmlContent += `<p>If you did not request this, please ignore this email. The link expires in 1 hour.</p>`;
  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to: user.email,
    subject: 'Password Reset Request',
    html: htmlContent,
  };
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`Error sending password reset email to ${user.email}:`, error);
    throw new ApiError(500, 'Error sending password reset email. Please try again later.');
  }
  return res.status(200).json(new ApiResponse(200, {}, 'Password reset link sent successfully'));
});

/**
 * resetPassword
 * -------------------------------------------
 * Resets the user's password using the provided reset token.
 * On successful reset, clears the reset token fields and the forcePasswordReset flag.
 * Steps:
 *   1. Validate the reset token and new password from the request.
 *   2. Find the user by the reset token and check token validity.
 *   3. Update the user's password (triggering the pre-save hashing hook).
 *   4. Clear the reset token and expiration fields.
 *   5. Clear the forcePasswordReset flag.
 *   6. Save the updated user record.
 *   7. Return a success response.
 *
 * @route POST /api/v1/users/resetPassword
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || typeof newPassword !== 'string' || !newPassword.trim()) {
    throw new ApiError(400, 'Reset token and a valid new password are required');
  }
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });
  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }
  user.password = newPassword.trim();
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  user.forcePasswordReset = false;
  try {
    await user.save({ validateBeforeSave: false });
  } catch (error) {
    console.error('Error resetting password:', error);
    throw new ApiError(500, 'Error resetting password. Please try again later.');
  }
  user.password = undefined;
  return res.status(200).json(new ApiResponse(200, {}, 'Password has been reset successfully'));
});

/**
 * inviteUser
 * ---------------------------
 * Endpoint for higher-level admins to invite a user.
 * This function:
 *  - Validates the request (email, role, OrgUnit, company are required)
 *  - Generates a unique invitation token and expiration (24 hours)
 *  - Creates an invitation record in the database
 *  - Sends a complete registration invitation email (with a registration link that includes the token)
 *
 * @route POST /api/v1/users/invite
 */
const inviteUser = asyncHandler(async (req, res) => {
  // Destructure and validate required fields from the request body.
  const { email, role, OrgUnit, company } = req.body;
  if (!email || !role || !OrgUnit || !company) {
    throw new ApiError(400, 'Email, role, OrgUnit, and company are required.');
  }

  // Generate a unique invitation token using crypto and set an expiration (24 hours)
  const token = crypto.randomBytes(20).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  // Create the invitation record
  const invitation = await Invitation.create({
    email,
    role,
    OrgUnit,
    company,
    token,
    expires,
  });

  // Prepare the invitation link using the FRONTEND_URL from your environment
  const invitationLink = `${process.env.FRONTEND_URL}/user-setup?token=${token}&email=${email}`;

  // Fetch company details for email personalization
  let companyDetails;
  try {
    companyDetails = await Company.findById(company);
  } catch (error) {
    console.error('Error fetching company details for invitation:', error);
    companyDetails = { CompanyName: 'Your Company Name' };
  }

  // Determine first name (if available, you might improve this by storing firstName separately)
  const firstName = email.split('@')[0];

  try {
    // Send the complete registration invitation email.
    await sendCompleteRegistrationEmail({
      to: email,
      firstName,
      invitationLink,
      role,
      companyName: companyDetails.CompanyName,
    });
  } catch (error) {
    console.error(`Error sending complete registration email to ${email}:`, error);
    // Optionally delete the invitation record if email sending fails.
    await Invitation.findByIdAndDelete(invitation._id);
    throw new ApiError(500, 'Error sending invitation email. Please try again later.');
  }

  // Return a successful response
  return res.status(201).json({ message: 'Invitation sent successfully.' });
});

/**
 * completeRegistration
 * ---------------------------
 * Endpoint for invited users to complete their registration.
 * The invited user must supply a valid token (from the invitation email),
 * along with the fields that they are allowed to set (e.g., fullName, password, phone).
 *
 * This function:
 *  - Validates that token, fullName, and password are provided.
 *  - Finds the corresponding invitation record that is not used and not expired.
 *  - Creates the new user record using invitation details (role, OrgUnit, company)
 *    and the invited user’s provided details.
 *  - Marks the invitation as used.
 *
 * @route POST /api/v1/users/completeRegistration
 */
const completeRegistration = asyncHandler(async (req, res) => {
  // Destructure required fields from the request body.
  const { token, fullName, password, phone } = req.body;
  if (!token || !fullName || !password) {
    throw new ApiError(400, 'Token, full name, and password are required.');
  }

  // Find the invitation record with the token, ensure it has not been used and is still valid.
  const invitation = await Invitation.findOne({ token, used: false });
  if (!invitation) {
    throw new ApiError(400, 'Invalid or expired invitation token.');
  }
  if (invitation.expires < Date.now()) {
    throw new ApiError(400, 'Invitation token has expired.');
  }

  // Create the new user record.
  // Note: The email, role, OrgUnit, and company come from the invitation.
  const user = await User.create({
    email: invitation.email,
    fullName: fullName.trim(),
    password: password.trim(),
    phone, // optional field
    role: invitation.role,
    OrgUnit: invitation.OrgUnit,
    company: invitation.company,
  });

  // Mark the invitation as used.
  invitation.used = true;
  await invitation.save();

  // Return the created user without sensitive fields.
  const createdUser = await User.findById(user._id).select('-password -refreshToken');
  return res.status(201).json({ message: 'Registration complete.', user: createdUser });
});

// Export all user-related controllers (excluding updateUserPassword)
export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  getUserByEmail,
  updateUserDetails,
  deleteUser,
  getAllUser,
  forgotPassword,
  resetPassword,
  inviteUser,
  completeRegistration,
};
