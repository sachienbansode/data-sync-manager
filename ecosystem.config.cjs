// PM2 ecosystem config for Ananta Platform (AWS production)
// Uses CommonJS (.cjs) so PM2 can require() it without ESM issues
// Environment variables are sourced from .env.production before PM2 starts

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
