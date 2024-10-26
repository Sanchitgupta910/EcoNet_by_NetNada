import {Router} from "express";
import { registerUser, loginUser, logoutUser, refreshAccessToken } from "../controllers/user.controllers.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";


const router = Router()

router.route("/register").post(registerUser)
router.route("/login").post(loginUser)


//secure routes
router.route("/logout").post(verifyJWT, logoutUser)
router.route('/refresh-token').post(refreshAccessToken)


export default router