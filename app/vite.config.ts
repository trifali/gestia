import { defineConfig } from 'vite'
import { wasp } from 'wasp/client/vite'

export default defineConfig({
  plugins: [wasp()],
  server: {
    open: true,
  },
  optimizeDeps: {
    include: [
      '@syncfusion/ej2-base',
      '@syncfusion/ej2-react-filemanager',
    ],
  },
})
