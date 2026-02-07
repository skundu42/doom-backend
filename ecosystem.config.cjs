module.exports = {
  apps: [
    {
      name: "doomscroll-backend",
      script: "dist/index.js",
      watch: false,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
