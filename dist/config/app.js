import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();
const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
let BASE_URL;
if (isRailway) {
    BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : process.env.BASE_URL || `https://mcp-wesype-server-production.up.railway.app`;
}
else {
    BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
}
export const config = {
    PORT,
    NODE_ENV: process.env.NODE_ENV || 'development',
    BASE_URL,
    isRailway,
    isProduction,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret-key',
    __dirname,
    __filename
};
export function setupMiddleware(app) {
    app.use(express.static(path.join(__dirname, '../../public')));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    if (config.NODE_ENV === 'development') {
        app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }
}
export function setupErrorHandling(app) {
    app.use((err, req, res, next) => {
        console.error(`Error: ${err.message}`);
        console.error(err.stack);
        res.status(500).json({
            error: 'Something went wrong!',
            ...(config.NODE_ENV === 'development' && { details: err.message })
        });
    });
    app.use('*', (req, res) => {
        res.status(404).json({
            error: 'Route not found',
            path: req.originalUrl
        });
    });
}
