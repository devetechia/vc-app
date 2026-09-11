export default async function run(page, ui) {
    // Check all script tags
    const scripts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('script[src]')).map(s => ({
            src: s.src,
            loaded: s.readyState || 'unknown'
        }));
    });

    // Try loading Supabase manually
    const loadResult = await page.evaluate(() => {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = () => resolve({ loaded: true, supabase: typeof window.supabase });
            script.onerror = (e) => resolve({ loaded: false, error: 'load failed' });
            document.head.appendChild(script);
            setTimeout(() => resolve({ loaded: false, timeout: true }), 10000);
        });
    });

    return { scripts, loadResult };
}
