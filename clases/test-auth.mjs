export default async function run(page, ui) {
    // Go to page and wait for networkidle
    await page.goto('https://devetechia.github.io/vc-app/clases/', { waitUntil: 'networkidle' });
    
    // Check all functions
    const check = await page.evaluate(() => {
        const results = {};
        const fns = ['getSupabase', 'openAuthModal', 'signUp', 'signIn', 'signOut', 'isLoggedIn', 'getUser', 'initNavbar', 'saveNote', 'generateQuiz', 'loadTranscript'];
        for (const fn of fns) {
            results[fn] = typeof window[fn];
        }
        results.windowSupabase = typeof window.supabase;
        results.windowKeys = Object.keys(window).filter(k => k.toLowerCase().includes('supa') || k.toLowerCase().includes('auth') || k.toLowerCase().includes('sign'));
        return results;
    });
    
    return check;
}
