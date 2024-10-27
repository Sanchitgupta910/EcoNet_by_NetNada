import { Router } from "express";

const router = Router();

router.route("/addwaste").post(addWaste);

export default router