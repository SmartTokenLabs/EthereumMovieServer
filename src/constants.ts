import dotenv from "dotenv";

dotenv.config();

export const SQLite_DB_FILE = process.env.SQLite_DB_FILE;
export const PATH_TO_CERT = process.env.CERT_PATH;
export const INFURA_KEY = process.env.INFURA_KEY;
export const MOVIE_NAME = process.env.MOVIE_NAME;
export const NODE_ENV = process.env.NODE_ENV;
export const CERT_PATH = process.env.CERT_PATH;
export const PROD_PORT = process.env.PROD_PORT;
