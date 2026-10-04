import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const supabaseUrl = JSON.stringify(process.env.VITE_SUPABASE_URL || '');
const supabasePublishableKey = JSON.stringify(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');
const buildVer = Date.now().toString(36);

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist', import.meta.url), { recursive: true });
await cp(new URL('../web', import.meta.url), new URL('../dist', import.meta.url), { recursive: true });

// Inject config
const configPath = new URL('../dist/app-config.js', import.meta.url);
const config = await readFile(configPath, 'utf8');
await writeFile(configPath, config.replace('EASYATTEND_SUPABASE_URL = ""', `EASYATTEND_SUPABASE_URL = ${supabaseUrl}`).replace('EASYATTEND_SUPABASE_PUBLISHABLE_KEY = ""', `EASYATTEND_SUPABASE_PUBLISHABLE_KEY = ${supabasePublishableKey}`));

// Cache-bust index.html assets
const indexPath = new URL('../dist/index.html', import.meta.url);
let indexHtml = await readFile(indexPath, 'utf8');
indexHtml = indexHtml
  .replace('/src/styles.css', `/src/styles.css?v=${buildVer}`)
  .replace('/src/main.js', `/src/main.js?v=${buildVer}`)
  .replace('/app-config.js', `/app-config.js?v=${buildVer}`);
await writeFile(indexPath, indexHtml);
