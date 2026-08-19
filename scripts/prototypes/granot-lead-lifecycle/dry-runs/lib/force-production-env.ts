/**
 * Must be the first import of any script that writes official production
 * Registry rows. ESM evaluates this before later imports, so
 * getMongoDatabaseName() / connectMongo see TEST_MODE=false.
 */
process.env.TEST_MODE = "false";
