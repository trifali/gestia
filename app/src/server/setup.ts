import express from 'express';
import type { Application } from 'express';

// Increase JSON body limit to 30 MB to cover base64-encoded file uploads (20 MB raw ≈ 27 MB base64).
export const serverSetup = ({ app }: { app: Application }) => {
  app.use(express.json({ limit: '30mb' }));
};
