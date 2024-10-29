import {Router} from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { createNewAddress, updateBranchDetails, deleteBranch } from "../controllers/branchAddress.controllers.js";



const router = Router()

router.route("/addCompanyAddress").post(verifyJWT, createNewAddress);
router.route("/updateCompanyAddress").post(verifyJWT, updateBranchDetails);
router.route("/deleteCompanyAddress").post(verifyJWT, deleteBranch);




export default router