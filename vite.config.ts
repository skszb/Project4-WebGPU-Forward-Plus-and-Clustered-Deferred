import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        target: 'esnext'
    },
    base: '/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred/'// process.env.GITHUB_ACTIONS_BASE || undefined
})
