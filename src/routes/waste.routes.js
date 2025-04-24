import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { verifyServiceKey } from '../middlewares/verifyServiceKey.js';
import { addWaste } from '../controllers/waste.controllers.js';
const router = Router();

router.route('/ingest').post(verifyServiceKey, addWaste);
router.post('/', verifyJWT, addWaste); //just incase if required for testing or admin overrides

export default router;
