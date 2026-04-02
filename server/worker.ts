if (!process.env.NOTIFICATION_WORKER_MODE) {
  process.env.NOTIFICATION_WORKER_MODE = "worker";
}

await import("./index.ts");
