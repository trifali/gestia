import { defineConfig } from 'vite'
import path from 'node:path'

// Force a single copy of React (and friends) so Wasp's nested `web-app`
// `node_modules` cannot accidentally pull in a different React version
// via @tanstack/react-query's peer dependency auto-install.
const appNodeModules = path.resolve(__dirname, 'node_modules')

export default defineConfig({
  server: {
    open: true,
  },
  resolve: {
    alias: {
      react: path.join(appNodeModules, 'react'),
      'react-dom': path.join(appNodeModules, 'react-dom'),
      'react-dom/client': path.join(appNodeModules, 'react-dom/client.js'),
      'react/jsx-runtime': path.join(appNodeModules, 'react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(appNodeModules, 'react/jsx-dev-runtime.js'),
    },
  },
})
