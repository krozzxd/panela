import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startBot } from "./bot";

log("Iniciando servidor Express...", "express");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Rota de healthcheck
app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

// Middleware de log
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Função principal de inicialização
async function main() {
  try {
    // Verificar variáveis de ambiente críticas
    log("Verificando variáveis de ambiente...", "express");

    if (!process.env.DISCORD_TOKEN) {
      log("DISCORD_TOKEN não encontrado!", "express");
      throw new Error("Token do Discord não encontrado! Configure a variável de ambiente DISCORD_TOKEN.");
    }
    log("✓ DISCORD_TOKEN encontrado", "express");

    if (!process.env.DATABASE_URL) {
      log("DATABASE_URL não encontrado!", "express");
      throw new Error("URL do banco de dados não encontrada! Configure a variável de ambiente DATABASE_URL.");
    }
    log("✓ DATABASE_URL encontrado", "express");

    log("Registrando rotas...", "express");
    const server = registerRoutes(app);

    // Handler de erros global
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Erro Interno do Servidor";

      log(`Erro: ${status} - ${message}`, "express");
      res.status(status).json({ message });
    });

    // Configurar ambiente
    log("Configurando ambiente...", "express");
    if (app.get("env") === "development") {
      log("Iniciando em modo desenvolvimento", "express");
      await setupVite(app, server);
    } else {
      log("Iniciando em modo produção", "express");
      serveStatic(app);
    }

    // Iniciar o bot do Discord
    log("Iniciando bot do Discord...", "express");
    try {
      await startBot();
      log("Bot do Discord iniciado com sucesso!", "express");
    } catch (error) {
      log(`Erro ao iniciar o bot do Discord: ${error}`, "express");
      throw error;
    }

    // Iniciar o servidor HTTP
    const PORT = process.env.PORT || 5000;
    server.listen(Number(PORT), "0.0.0.0", () => {
      log(`Servidor rodando em http://0.0.0.0:${PORT}`, "express");
    });
  } catch (error) {
    log(`Erro fatal ao iniciar servidor: ${error}`, "express");
    process.exit(1);
  }
}

// Iniciar a aplicação
main().catch((error) => {
  log(`Erro não tratado: ${error}`, "express");
  process.exit(1);
});