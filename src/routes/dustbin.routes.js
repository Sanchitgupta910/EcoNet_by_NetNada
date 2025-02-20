import {Router} from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { addDustbin, getCurrentWeight, aggregatedWasteData } from "../controllers/dustbin.controllers.js";



const router = Router()

router.route("/adddustbin").post(verifyJWT, addDustbin);
router.route("/currentweight/:id").get(verifyJWT, getCurrentWeight);
//router.route("/bindetails").get(verifyJWT, getCompanyWithDustbins);
router.get('/aggregated', aggregatedWasteData);

export default router