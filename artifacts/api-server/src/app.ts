import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { eq, and } from "drizzle-orm";
import { db, shortDomainsTable } from "@workspace/db";
import router from "./routes";
import { handleRedirect } from "./routes/url-shortener";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Public short URL redirect — outside /api so it resolves as /s/:code
app.get("/s/:code", handleRedirect);

// Custom domain redirect — requests arriving on verified custom domains
app.get("/:code", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { code } = req.params;
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(code)) { next(); return; }
    const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
    const [domain] = await db.select({ id: shortDomainsTable.id })
      .from(shortDomainsTable)
      .where(and(eq(shortDomainsTable.domain, host), eq(shortDomainsTable.isVerified, true)));
    if (!domain) { next(); return; }
    await handleRedirect(req, res);
  } catch { next(); }
});

// Global error handler — always return JSON so clients get useful messages
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error({ err, stack, url: req.url, method: req.method }, "Unhandled error");
  res.status(500).json({ error: message });
});

export default app;
