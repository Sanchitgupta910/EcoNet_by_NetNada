import {Router} from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { addDustbin } from "../controllers/dustbin.controllers.js";



const router = Router()

router.route("/adddustbin").post(verifyJWT, addDustbin);



export default router