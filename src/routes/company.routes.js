import {Router} from "express";
import {createNewCompany, updateCompanyDetails, deleteCompany} from "../controllers/company.controllers.js"
import { verifyJWT } from "../middlewares/auth.middleware.js";
const router = Router()


router.route("/addCompany").post(verifyJWT, createNewCompany );
router.route("/updateCompany").post(verifyJWT, updateCompanyDetails);
router.route("/deleteCompany").post(verifyJWT, deleteCompany);

export default router