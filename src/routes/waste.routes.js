import { Router } from "express";
import { addWaste } from "../controllers/waste.controllers.js";
const router = Router();

router.route("/addwaste").post(addWaste);

export default router