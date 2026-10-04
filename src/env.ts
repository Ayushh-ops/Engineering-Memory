import path from "node:path";
import dotenv from "dotenv";

// Load .env explicitly from project root before any other module imports
dotenv.config({ path: path.resolve(__dirname, "../.env") });
