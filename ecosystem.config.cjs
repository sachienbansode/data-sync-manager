// PM2 ecosystem config for Ananta Platform (AWS production)
// Uses CommonJS (.cjs) so PM2 can require() it without ESM issues
//
// Environment variables are loaded from .env.production using Node's built-in
// `fs` module — more reliable than PM2's own env_file option.

const fs   = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, ".env.production");

/**
 * Parse a .env file into a plain object.
 * Skips blank lines and comments. Strips surrounding quotes from values.
 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[ecosystem] WARNING: ${filePath} not found — env vars will not be loaded`);
    return {};
  }
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const env   = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let   val = line.slice(eqIdx + 1).trim();
    // Strip surrounding single or double quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const envVars = loadEnvFile(ENV_FILE);

module.exports = {
  apps: [
    {
      name: 'ananta-api',
      script: './artifacts/api-server/dist/index.mjs',
      cwd: '/home/ubuntu/ananta-platform',
      interpreter: 'node',
      interpreter_args: '--enable-source-maps',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT:     '8080',
        ...envVars,   // All vars from .env.production are injected here
      },
      error_file: '/home/ubuntu/logs/ananta-api-error.log',
      out_file:   '/home/ubuntu/logs/ananta-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
