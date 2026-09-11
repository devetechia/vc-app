export default async function run(page, ui) {
    // Load supabase via fetch and eval
    const result = await page.evaluate(async () => {
        try {
            const resp = await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
            const text = await resp.text();
            eval(text);
            return { 
                loaded: true,
                type: typeof supabase,
                hasCreateClient: typeof supabase?.createClient === 'function',
                windowSupabase: typeof window.supabase
            };
        } catch(e) {
            return { error: e.message };
        }
    });
    return result;
}
