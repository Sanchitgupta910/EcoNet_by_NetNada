import {Router} from "express";
import {createNewCompany} from "../controllers/company.controllers.js"
import { verifyJWT } from "../middlewares/auth.middleware.js";
const router = Router()


router.route("/addCompany").post(verifyJWT, createNewCompany );

export default router