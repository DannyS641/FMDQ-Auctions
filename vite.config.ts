import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  server: {
    port: 5173
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        bidding: resolve(__dirname, "bidding.html"),
        item: resolve(__dirname, "item.html"),
        signin: resolve(__dirname, "signin.html"),
        signup: resolve(__dirname, "signup.html"),
        verify: resolve(__dirname, "verify.html"),
        adminItem: resolve(__dirname, "admin-item.html"),
        closed: resolve(__dirname, "closed.html"),
        won: resolve(__dirname, "won.html"),
        operations: resolve(__dirname, "operations.html")
      }
    }
  }
});
