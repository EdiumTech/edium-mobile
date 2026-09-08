import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const directoryRoutes = new Set(['/join', '/join/admin'])

function redirectDirectoryRoutes() {
  const configure = server => {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url || '/', 'http://localhost')
      if (!directoryRoutes.has(url.pathname)) {
        next()
        return
      }

      response.statusCode = 308
      response.setHeader('Location', `${url.pathname}/${url.search}`)
      response.end()
    })
  }

  return {
    name: 'redirect-directory-routes',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export default defineConfig({
  plugins: [redirectDirectoryRoutes(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        join: resolve(__dirname, 'join/index.html'),
        joinAdmin: resolve(__dirname, 'join/admin/index.html'),
      },
    },
  },
})
