import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import rolesRouter from "./roles";
import dashboardRouter from "./dashboard";
import smtpRouter from "./smtp";
import emailOtpRouter from "./email-otp";
import appSettingsRouter from "./app-settings";
import piiRouter from "./pii";
import dbConnectionsRouter from "./db-connections";
import workflowRouter from "./workflow";
import docsRouter from "./docs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(emailOtpRouter);
router.use(usersRouter);
router.use(rolesRouter);
router.use(dashboardRouter);
router.use(smtpRouter);
router.use(appSettingsRouter);
router.use(piiRouter);
router.use(dbConnectionsRouter);
router.use(workflowRouter);
router.use(docsRouter);

export default router;
