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
        adminItem: resolve(__dirname, "admin-item.html")
      }
    }
  }
});
