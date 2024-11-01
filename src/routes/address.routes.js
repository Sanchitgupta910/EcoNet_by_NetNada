import {Router} from "express";
import { verifyJWT, authorizeRoles } from "../middlewares/auth.middleware.js";
import { createNewAddress, updateBranchDetails, deleteBranch } from "../controllers/branchAddress.controllers.js";



const router = Router()

router.route("/addCompanyAddress").post(verifyJWT,authorizeRoles("SuperAdmin"), createNewAddress);
router.route("/updateCompanyAddress").post(verifyJWT,authorizeRoles("SuperAdmin"), updateBranchDetails);
router.route("/deleteCompanyAddress").post(verifyJWT,authorizeRoles("SuperAdmin"), deleteBranch);




export default router