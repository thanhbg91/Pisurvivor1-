import path from "path";
import express from "express";
import app from "./api/index";

const PORT = 3000;

// Vite middleware for dev or Static asset serving for production
async function setupVite() {
  if (process.env.VERCEL) {
    console.log("[Pi Backend] Running in Vercel Serverless environment. Skipping app.listen.");
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

setupVite();

export default app;
