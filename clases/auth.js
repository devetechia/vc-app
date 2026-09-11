// Auth UI - auto-creates modal and handles auth for all pages
(function() {
    // Create auth modal if it doesn't exist
    if (!document.getElementById('authModal')) {
        const modal = document.createElement('div');
        modal.id = 'authModal';
        modal.style.cssText = 'display:none; position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.7); backdrop-filter:blur(4px); align-items:center; justify-content:center;';
        modal.innerHTML = `
            <div style="background:#161b22; border:1px solid #30363d; border-radius:16px; padding:32px; width:90%; max-width:400px; position:relative;">
                <button onclick="closeAuthModal()" style="position:absolute; top:12px; right:16px; background:none; border:none; color:#8b949e; font-size:20px; cursor:pointer;">&times;</button>
                <h2 id="authTitle" style="color:#ffd700; margin-bottom:16px; text-align:center;">Iniciar sesion</h2>
                <div>
                    <input type="email" id="authEmail" placeholder="Email" style="width:100%; padding:12px; margin-bottom:12px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#c9d1d9; font-size:14px; box-sizing:border-box;">
                    <input type="password" id="authPassword" placeholder="Contrasena" style="width:100%; padding:12px; margin-bottom:12px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#c9d1d9; font-size:14px; box-sizing:border-box;">
                    <input type="text" id="authName" placeholder="Nombre (solo registro)" style="width:100%; padding:12px; margin-bottom:12px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#c9d1d9; font-size:14px; box-sizing:border-box; display:none;">
                    <div id="authError" style="color:#f85149; font-size:13px; margin-bottom:8px; display:none;"></div>
                    <button id="authSubmit" class="btn btn-gold" style="width:100%; margin-bottom:12px;">Iniciar sesion</button>
                    <p style="text-align:center; color:#8b949e; font-size:13px;">
                        <span id="authToggleText">No tienes cuenta?</span>
                        <a href="#" id="authToggleLink" style="color:#ffd700;">Registrate</a>
                    </p>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    let _isSignUp = false;

    window.openAuthModal = function() {
        document.getElementById('authModal').style.display = 'flex';
    };
    window.closeAuthModal = function() {
        document.getElementById('authModal').style.display = 'none';
    };
    window.toggleAuthMode = function() {
        _isSignUp = !_isSignUp;
        document.getElementById('authTitle').textContent = _isSignUp ? 'Crear cuenta' : 'Iniciar sesion';
        document.getElementById('authSubmit').textContent = _isSignUp ? 'Crear cuenta' : 'Iniciar sesion';
        document.getElementById('authName').style.display = _isSignUp ? 'block' : 'none';
        document.getElementById('authToggleText').textContent = _isSignUp ? 'Ya tienes cuenta?' : 'No tienes cuenta?';
        document.getElementById('authToggleLink').textContent = _isSignUp ? 'Inicia sesion' : 'Registrate';
        document.getElementById('authError').style.display = 'none';
    };

    window.handleAuth = async function() {
        const email = document.getElementById('authEmail').value;
        const pass = document.getElementById('authPassword').value;
        const name = document.getElementById('authName').value;
        const errEl = document.getElementById('authError');
        errEl.style.display = 'none';
        if (!email || !pass) { errEl.textContent = 'Email y contrasena son obligatorios'; errEl.style.display = 'block'; return; }
        try {
            if (_isSignUp) await signUp(email, pass, name);
            else await signIn(email, pass);
            closeAuthModal();
        } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    };

    // Bind toggle links
    document.getElementById('authToggleLink')?.addEventListener('click', (e) => { e.preventDefault(); toggleAuthMode(); });
    document.getElementById('authSubmit')?.addEventListener('click', handleAuth);

    // Update nav auth button
    function updateAuthBtn(user) {
        const btn = document.getElementById('authBtn');
        if (!btn) return;
        if (user) {
            btn.textContent = user.email?.split('@')[0] || 'Mi cuenta';
            btn.onclick = () => { if (confirm('Cerrar sesion?')) signOut(); };
        } else {
            btn.textContent = 'Iniciar sesion';
            btn.onclick = openAuthModal;
        }
    }
    onAuthChange(updateAuthBtn);
})();
