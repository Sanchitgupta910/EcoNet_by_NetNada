import {Router} from "express";
import {createNewCompany, updateCompanyDetails, deleteCompany, getCompany} from "../controllers/company.controllers.js"
import { verifyJWT, authorizeRoles } from "../middlewares/auth.middleware.js";
const router = Router()


router.route("/addCompany").post(verifyJWT, verifyJWT, authorizeRoles("SuperAdmin"), createNewCompany );
router.route("/updateCompany").post(verifyJWT, authorizeRoles("SuperAdmin"), updateCompanyDetails);
router.route("/deleteCompany").post(verifyJWT, authorizeRoles("SuperAdmin"), deleteCompany);
router.route("/getCompany").get(verifyJWT, getCompany)
export default router