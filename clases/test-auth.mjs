export default async function run(page, ui) {
    const result = await page.evaluate(() => {
        return new Promise((resolve) => {
            const before = new Set(Object.keys(window));
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
            script.onload = () => {
                const after = new Set(Object.keys(window));
                const newKeys = [...after].filter(k => !before.has(k));
                // Also check common patterns
                const checks = {};
                for (const k of ['supabase', 'Supabase', 'createClient', 'sb', 'sbjs']) {
                    checks[k] = typeof window[k];
                }
                resolve({ newKeys, checks, total: newKeys.length });
            };
            script.onerror = (e) => resolve({ error: 'onerror fired' });
            document.head.appendChild(script);
            setTimeout(() => resolve({ timeout: true }), 8000);
        });
    });
    return result;
}
