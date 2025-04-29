import { Router } from 'express';
import {
  createCleaner,
  getCleaner,
  listCleaners,
  updateCleaner,
  deleteCleaner,
} from '../controllers/cleaner.controllers.js';

const router = Router();

router
  .route('/')
  .get(listCleaners) // GET /api/v1/cleaners
  .post(createCleaner); // POST /api/v1/cleaners

router
  .route('/:id')
  .get(getCleaner) // GET /api/v1/cleaners/:id
  .patch(updateCleaner) // PATCH /api/v1/cleaners/:id
  .delete(deleteCleaner);

export default router;
