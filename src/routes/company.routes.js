import {Router} from "express";
import {createNewCompany, updateCompanyDetails, deleteCompany, getCompany, getCompanyById} from "../controllers/company.controllers.js"
import { verifyJWT, authorizeRoles } from "../middlewares/auth.middleware.js";
const router = Router()


//route starts with:   /api/v1/company

router.route("/addCompany").post(verifyJWT, authorizeRoles("SuperAdmin"), createNewCompany );
router.route("/updateCompany").post(verifyJWT, authorizeRoles("SuperAdmin"), updateCompanyDetails);
router.route("/deleteCompany").post(verifyJWT, authorizeRoles("SuperAdmin"), deleteCompany);
router.route("/getCompany").get(verifyJWT, getCompany)

router.route("/:id").get(verifyJWT, getCompanyById);
export default router