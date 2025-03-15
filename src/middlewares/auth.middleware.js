// import { ApiError } from '../utils/ApiError.js';
// import { asyncHandler } from '../utils/asyncHandler.js';
// import jwt from 'jsonwebtoken';
// import { User } from '../models/user.models.js';

// /**
//  * verifyJWT middleware:
//  *  - Reads the token from cookies or the Authorization header.
//  *  - Verifies the token using the secret.
//  *  - Fetches the corresponding user from the database (excluding sensitive fields).
//  *  - If the token or user is invalid, throws an Unauthorized error.
//  *  - Otherwise, attaches the user object to the request and calls next().
//  */
// export const verifyJWT = asyncHandler(async (req, res, next) => {
//   const unprotectedPaths = ['/resetPassword', '/forgotPassword'];
//   if (unprotectedPaths.some((path) => req.path === path)) {
//     return next();
//   }
//   try {
//     // Retrieve token from cookies or header
//     const token = req.cookies?.accessToken || req.headers?.authorization?.replace('Bearer ', '');

//     if (!token) {
//       throw new ApiError(401, 'Unauthorized request.');
//     }

//     // Log the token for debugging (remove in production)
//     console.log('Token received:', token);

//     // Verify the token using JWT secret
//     const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

//     // Fetch the user based on the decoded token's _id and exclude sensitive fields
//     const user = await User.findById(decodedToken?._id).select('-password -refreshToken');

//     if (!user) {
//       throw new ApiError(401, 'Invalid Access Token.');
//     }

//     // Attach the user object to the request for later middleware or controllers
//     req.user = user;
//     next();
//   } catch (error) {
//     // Optionally, log error.message for debugging
//     throw new ApiError(401, 'Invalid Access Token.');
//   }
// });

// /**
//  * authorizeRoles middleware:
//  *  - Accepts a list of roles.
//  *  - Checks if the authenticated user's role is included in the allowed roles.
//  *  - If not, throws a Forbidden error.
//  *  - Otherwise, calls next().
//  */
// export const authorizeRoles = (...roles) => {
//   return (req, res, next) => {
//     if (!roles.includes(req.user.role)) {
//       throw new ApiError(403, 'You do not have permission to perform this action.');
//     }
//     next();
//   };
// };

import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.models.js';

/**
 * verifyJWT middleware:
 *  - Reads the token from cookies or the Authorization header.
 *  - Verifies the token using the secret.
 *  - Fetches the corresponding user from the database (excluding sensitive fields).
 *  - If the token or user is invalid, throws an Unauthorized error.
 *  - Otherwise, attaches the user object to the request and calls next().
 */
export const verifyJWT = asyncHandler(async (req, res, next) => {
  const unprotectedPaths = [
    '/resetPassword',
    '/forgotPassword',
    '/api/v1/users/completeRegistration',
  ];
  if (unprotectedPaths.some((path) => req.path === path)) {
    return next();
  }

  let token;

  // First, try to retrieve the token from cookies
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  } else if (req.headers && req.headers.authorization) {
    // Extract token from the "Bearer <token>" header
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    throw new ApiError(401, 'Unauthorized request. No token provided.');
  }

  try {
    // Verify the token using the secret from environment variables
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    // Fetch the user based on the decoded token's _id and exclude sensitive fields
    const user = await User.findById(decodedToken?._id).select('-password -refreshToken');

    if (!user) {
      throw new ApiError(401, 'Invalid Access Token.');
    }

    // Attach the user object to the request for later middleware or controllers
    req.user = user;
    next();
  } catch (error) {
    // Log the error for debugging purposes (remove or sanitize for production)
    console.error('Token verification error:', error.message);
    throw new ApiError(401, 'Invalid Access Token.');
  }
});

/**
 * authorizeRoles middleware:
 *  - Accepts a list of roles.
 *  - Checks if the authenticated user's role is included in the allowed roles.
 *  - If not, throws a Forbidden error.
 *  - Otherwise, calls next().
 */
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, 'You do not have permission to perform this action.');
    }
    next();
  };
};
