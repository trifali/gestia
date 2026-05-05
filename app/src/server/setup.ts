import express from 'express';
import type { Application } from 'express';
import type { MiddlewareConfigFn } from 'wasp/server';

// Wasp's proper API: override the 'express.json' entry in the global middleware Map.
// This runs before any route is registered, so the limit is applied everywhere.
export const serverMiddlewareFn: MiddlewareConfigFn = (config) => {
  config.set('express.json', express.json({ limit: '30mb' }));
  return config;
};

// setupFn kept for any future server-level setup needs.
export const serverSetup = (_: { app: Application }) => {};

