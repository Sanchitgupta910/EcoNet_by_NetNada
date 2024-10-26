import {Router} from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { createNewAddress } from "../controllers/branchAddress.controllers.js";



const router = Router()

router.route("/addCompanyAddress").post(verifyJWT, createNewAddress);






export default router