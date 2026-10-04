import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const apiUrl = JSON.stringify(process.env.VITE_API_BASE_URL || '');
await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist', import.meta.url), { recursive: true });
await cp(new URL('../web', import.meta.url), new URL('../dist', import.meta.url), { recursive: true });
const configPath = new URL('../dist/app-config.js', import.meta.url);
const config = await readFile(configPath, 'utf8');
await writeFile(configPath, config.replace('""', apiUrl));
