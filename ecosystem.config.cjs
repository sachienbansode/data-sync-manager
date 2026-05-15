// PM2 ecosystem config for Ananta Platform (AWS production)
// Uses CommonJS (.cjs) so PM2 can require() it without ESM issues
//
// run.sh sources .env.production before starting Node — no PM2 env_file needed.

module.exports = {
  apps: [
    {
      name: 'ananta-api',
      script: '/home/ubuntu/ananta-platform/run.sh',
      cwd: '/home/ubuntu/ananta-platform',
      interpreter: 'bash',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: '/home/ubuntu/logs/ananta-api-error.log',
      out_file: '/home/ubuntu/logs/ananta-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
