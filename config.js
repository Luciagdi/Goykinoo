// ===================================================
// config.js — АЮУЛГҮЙ ТОХИРГООНЫ ФАЙЛ
// ===================================================
// АНХААРУУЛГА: Энэ файлыг .gitignore дотор нэмнэ үү!
// ===================================================
 
// --- Supabase ---
const SUPABASE_URL      = 'https://mnglegavqvpysofyezwm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZ2xlZ2F2cXZweXNvZnllendtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzA3NjcsImV4cCI6MjA5NzU0Njc2N30.X64AGOH8i-d_CKiC3SHYaSMNdMqvgxiYzMcu-YB8iks';
 
// --- Cloudflare Worker ---
// Worker deploy хийсний дараа жинхэнэ URL-аа оруулна уу
// Cloudflare Dashboard → Workers & Pages → goykino-worker → URL-ийг хуулах
const WORKER_URL = 'https://goykino-worker.YOUR_NAME.workers.dev';
// ⚠️  YOUR_NAME-ийг өөрийн Cloudflare account subdomain-аар солино уу!

// WORKER_SECRET устгагдлаа ✅
// Worker одоо Supabase JWT токенээр баталгаажуулдаг тул клиент талд нууц түлхүүр хадгалах шаардлагагүй
 
// --- R2 Public URL ---
// Cloudflare Dashboard → R2 → goykino-videos bucket → Settings → Public Access
const R2_PUBLIC_URL = 'https://pub-26291c6fb75247b9be1579871e6f7089.r2.dev';
 
// --- Банкны мэдээлэл ---
const BANK_NAME    = 'Хаан Банк';
const BANK_OWNER   = 'Энхнамуун Хандсүрэн';
const BANK_ACCOUNT = '910005005250718075';