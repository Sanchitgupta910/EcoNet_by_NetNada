import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import CompanyRouter from './routes/company.routes.js';
import AddressRouter from './routes/address.routes.js';
import UserRouter from './routes/user.routes.js';
import DustbinRouter from './routes/dustbin.routes.js';
import WasteRoute from './routes/waste.routes.js';
import AnalyticsRouter from './routes/analytics.routes.js';
import OrgUnitRouter from './routes/orgUnit.routes.js';
import BinDashboardAnalyticsRouter from './routes/binDashboardAnalytics.routes.js';
import LocalAdminAnalyticsRouter from './routes/LocalAdminAnalytics.routes.js';
import CleanerRouter from './routes/cleaner.routes.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());

app.use('/NetNada/api/v1/company', CompanyRouter);
app.use('/NetNada/api/v1/address', AddressRouter);
app.use('/NetNada/api/v1/users', UserRouter);
app.use('/NetNada/api/v1/dustbin', DustbinRouter);
app.use('/NetNada/api/v1/waste', WasteRoute);
app.use('/NetNada/api/v1/analytics', AnalyticsRouter);
app.use('/NetNada/api/v1/orgUnits', OrgUnitRouter);
app.use('/NetNada/api/v1/binDashboardAnalytics', BinDashboardAnalyticsRouter);
app.use('/NetNada/api/v1/localAdminAnalytics', LocalAdminAnalyticsRouter);
app.use('/NetNada/api/v1/cleaners', CleanerRouter);

export { app };
