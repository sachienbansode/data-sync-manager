import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import rolesRouter from "./roles";
import dashboardRouter from "./dashboard";
import smtpRouter from "./smtp";
import emailOtpRouter from "./email-otp";
import appSettingsRouter from "./app-settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(emailOtpRouter);
router.use(usersRouter);
router.use(rolesRouter);
router.use(dashboardRouter);
router.use(smtpRouter);
router.use(appSettingsRouter);

export default router;
