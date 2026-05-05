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
      '@syncfusion/ej2-react-richtexteditor',
      '@syncfusion/ej2-react-spreadsheet',
      '@syncfusion/ej2-react-documenteditor',
    ],
  },
})
