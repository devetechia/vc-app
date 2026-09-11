const SUPABASE_URL = 'https://ndhvqhzfsdedhstllpic.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kaHZxaHpmc2RlZGhzdGxscGljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzU3ODksImV4cCI6MjEwNDcxMTc4OX0.JpMERVzSydYkTSpTdV-b7ckhsWO8duvurqwMAxN1LfE';

let _supabaseClient = null;
let _currentUser = null;
let _onAuthChange = [];

function getSupabase() {
    if (_supabaseClient) return _supabaseClient;
    const createFn = window._supabaseCreateClient;
    if (!createFn) return null;
    _supabaseClient = createFn(SUPABASE_URL, SUPABASE_ANON);
    _supabaseClient.auth.onAuthStateChange((event, session) => {
        _currentUser = session?.user || null;
        _onAuthChange.forEach(fn => fn(_currentUser, event));
    });
    return _supabaseClient;
}

function onAuthChange(fn) {
    _onAuthChange.push(fn);
    if (_currentUser) fn(_currentUser, 'initial');
    const sb = getSupabase();
    if (sb) sb.auth.getSession().then(({ data }) => {
        _currentUser = data?.session?.user || null;
        fn(_currentUser, 'init');
    });
}

function isLoggedIn() { return !!_currentUser; }
function getUser() { return _currentUser; }

async function signUp(email, password, displayName) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not loaded');
    const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: displayName } }
    });
    if (error) throw error;
    return data;
}

async function signIn(email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not loaded');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

async function signOut() {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    _currentUser = null;
}

// Generic CRUD
async function sbQuery(table, queryFn) {
    const sb = getSupabase();
    if (!sb || !_currentUser) return null;
    let q = sb.from(table).select('*').eq('user_id', _currentUser.id);
    if (queryFn) q = queryFn(q);
    const { data, error } = await q;
    if (error) { console.error('SB query error:', error); return null; }
    return data;
}

async function sbUpsert(table, row) {
    const sb = getSupabase();
    if (!sb || !_currentUser) return null;
    row.user_id = _currentUser.id;
    const { data, error } = await sb.from(table).upsert(row, { onConflict: 'user_id,video_id' }).select();
    if (error) { console.error('SB upsert error:', error); return null; }
    return data;
}

async function sbDelete(table, videoId) {
    const sb = getSupabase();
    if (!sb || !_currentUser) return false;
    const { error } = await sb.from(table).delete().eq('user_id', _currentUser.id).eq('video_id', videoId);
    return !error;
}

// Notes
async function getNotesFromDB() {
    const rows = await sbQuery('notes');
    if (!rows) return {};
    const notes = {};
    rows.forEach(r => { notes[r.video_id] = { text: r.content, updated: r.updated_at }; });
    return notes;
}

async function saveNoteToDB(videoId, text) {
    return await sbUpsert('notes', { video_id: videoId, content: text });
}

async function deleteNoteFromDB(videoId) {
    return await sbDelete('notes', videoId);
}

// Studies
async function getStudyFromDB(videoId) {
    const rows = await sbQuery('studies', q => q.eq('video_id', videoId));
    return rows && rows.length ? rows[0].result : null;
}

async function saveStudyToDB(videoId, title, result) {
    return await sbUpsert('studies', { video_id: videoId, title, result });
}

async function deleteStudyFromDB(videoId) {
    return await sbDelete('studies', videoId);
}

// Transcripts
async function getTranscriptFromDB(videoId) {
    const rows = await sbQuery('transcripts', q => q.eq('video_id', videoId));
    return rows && rows.length ? rows[0].transcript : null;
}

async function saveTranscriptToDB(videoId, transcript, source) {
    return await sbUpsert('transcripts', { video_id: videoId, transcript, source: source || 'manual' });
}

// Quiz history
async function getQuizHistoryFromDB() {
    const rows = await sbQuery('quiz_history', q => q.order('created_at', { ascending: false }));
    return rows || [];
}

async function saveQuizToDB(videoId, videoTitle, score, total, questions) {
    const sb = getSupabase();
    if (!sb || !_currentUser) return null;
    const { data, error } = await sb.from('quiz_history').insert({
        user_id: _currentUser.id,
        video_id: videoId,
        video_title: videoTitle,
        score, total, questions
    }).select();
    if (error) { console.error('SB quiz insert error:', error); return null; }
    return data;
}

// Migrate localStorage to Supabase
async function migrateLocalStorageToDB() {
    if (!_currentUser) return 0;
    let migrated = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('academia_')) {
            try {
                const val = JSON.parse(localStorage.getItem(key));
                if (key.startsWith('academia_notes_')) {
                    const videoId = key.replace('academia_notes_', '');
                    await saveNoteToDB(videoId, val.text || val);
                    migrated++;
                } else if (key.startsWith('academia_study_')) {
                    const videoId = key.replace('academia_study_', '');
                    await saveStudyToDB(videoId, '', val);
                    migrated++;
                }
            } catch {}
        }
    }
    return migrated;
}
