// migrate-mongo config. Mirrors the URI resolution in src/server/db/mongo.ts
// (db name comes from the URI path, same default: mongodb://localhost:27017/olio).

const config = {
  mongodb: {
    url: process.env.MONGODB_URI || "mongodb://localhost:27017/olio",
    databaseName: undefined,
    options: {},
  },

  migrationsDir: "migrations",
  changelogCollectionName: "changelog",
  lockCollectionName: "changelog_lock",
  lockTtl: 0,
  migrationFileExtension: ".js",
  useFileHash: false,
  moduleSystem: "esm",
};

module.exports = config;
