// PM2 ecosystem config for Ananta Platform (AWS production)
// Uses CommonJS (.cjs) so PM2 can require() it without ESM issues
//
// The app self-loads .env.production via lib/db/src/index.ts —
// no special PM2 env setup required. Just start normally:
//   pm2 start ecosystem.config.cjs
//   pm2 save

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
        PORT: '8080',
      },
      error_file: '/home/ubuntu/logs/ananta-api-error.log',
      out_file: '/home/ubuntu/logs/ananta-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
