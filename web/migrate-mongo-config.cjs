if (
  process.env.OLIO_REQUIRE_EXPLICIT_MIGRATION_URI === "1" &&
  !process.env.MONGODB_URI
) {
  throw new Error(
    "An explicit MONGODB_URI is required for this migration run.",
  );
}

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
