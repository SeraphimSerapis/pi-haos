import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8099);
const host = process.env.HOST ?? '0.0.0.0';
const app = createApp();

await app.listen({ port, host });
