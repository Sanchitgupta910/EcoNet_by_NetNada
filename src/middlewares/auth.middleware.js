//middleware used to logout a loggedin user

import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.models.js";

export const verifyJWT = asyncHandler(async(req, res, next) => {
    try {
        const token = req.cookies?.accessToken || req.headers?.authorization?.replace("Bearer ","")
    
        if (!token){
            throw new ApiError(401, "Unauthoried request.")
        }
    
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken")
    
        if (!user) {
            throw new ApiError(401, "Invalid Access Token.")
        }
    
        req.user= user;
        next()
    } catch (error) {
        throw new ApiError(401, " Invalid Access Token.")
    }
})

//middleware to authorize user based on role
export const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if(!roles.includes(req.user.role)){
            throw new ApiError(403, "You do not have permission to perform this action.")
        }
        next()
    }
}