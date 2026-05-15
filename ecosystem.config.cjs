// PM2 ecosystem config for Ananta Platform (AWS production)
// Uses CommonJS (.cjs) so PM2 can require() it without ESM issues
//
// HOW TO START:
//   cd /home/ubuntu/ananta-platform
//   set -o allexport && source .env.production && set +o allexport
//   pm2 delete ananta-api
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
      // env_file support varies by PM2 version — use the startup script above
      // to reliably inject .env.production vars before starting.
      env_file: '/home/ubuntu/ananta-platform/.env.production',
      env_production: {
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
