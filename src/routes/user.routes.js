import { Router } from 'express';
import {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  updateUserPassword,
  updateUserDetails,
  deleteUser,
  getAllUser,
  getUserByEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/user.controllers.js';
import { verifyJWT, authorizeRoles } from '../middlewares/auth.middleware.js';

const router = Router();

//route starts with:   /api/v1/users
router.route('/register').post(verifyJWT, authorizeRoles('SuperAdmin'), registerUser);
router.route('/login').post(loginUser);

//secure routes
router.route('/logout').post(verifyJWT, logoutUser);
router.route('/refresh-token').post(refreshAccessToken);
router.route('/me').get(verifyJWT, getCurrentUser);
router.route('/updatepassword').post(verifyJWT, updateUserPassword); //update password
router.route('/byEmail').get(getUserByEmail);
router.route('/all-users').get(verifyJWT, authorizeRoles('SuperAdmin'), getAllUser);
router.route('/updateuser').post(verifyJWT, authorizeRoles('SuperAdmin'), updateUserDetails);
router.route('/deleteuser').post(verifyJWT, authorizeRoles('SuperAdmin'), deleteUser);

//public routes for password reset operation
router.route('/forgotPassword').post(forgotPassword);
router.route('/resetPassword').post(resetPassword);

export default router;
