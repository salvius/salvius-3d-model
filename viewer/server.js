import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, '..');
const app = express();
const port = Number(process.env.PORT ?? 8080);
const modelDirectory = path.resolve(process.env.MODEL_DIR ?? repositoryRoot);
const urdfFile = path.resolve(process.env.URDF_FILE ?? path.join(repositoryRoot, 'salvius.urdf'));

app.get('/model/robot.urdf', (_request, response, next) => {
  response.type('application/xml').sendFile(urdfFile, error => {
    if (error) next(error);
  });
});

app.use('/model', express.static(modelDirectory, {
  dotfiles: 'ignore',
  index: false,
  fallthrough: true,
  setHeaders(response, filePath) {
    if (filePath.endsWith('.urdf')) response.type('application/xml');
    if (filePath.endsWith('.stl')) response.type('model/stl');
    if (filePath.endsWith('.dae')) response.type('model/vnd.collada+xml');
  },
}));

if (process.env.NODE_ENV === 'development') {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const buildDirectory = path.join(root, 'dist');
  app.use(express.static(buildDirectory));
  app.use((request, response, next) => {
    if (request.method === 'GET' && request.accepts('html')) {
      response.sendFile(path.join(buildDirectory, 'index.html'), error => {
        if (error) next(error);
      });
      return;
    }
    next();
  });
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status ?? 500).send('Unable to serve the viewer asset.');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Salvius viewer listening on http://0.0.0.0:${port}`);
});