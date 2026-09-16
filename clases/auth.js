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

    // Create user dropdown menu
    if (!document.getElementById('userDropdown')) {
        const dropdown = document.createElement('div');
        dropdown.id = 'userDropdown';
        dropdown.style.cssText = 'display:none; position:fixed; top:60px; right:20px; z-index:9999; background:#161b22; border:1px solid #30363d; border-radius:12px; padding:8px 0; min-width:200px; box-shadow:0 8px 32px rgba(0,0,0,0.5);';
        dropdown.innerHTML = `
            <div id="dropdownUserInfo" style="padding:12px 16px; border-bottom:1px solid #30363d; color:#c9d1d9; font-size:13px;">
                <div style="font-weight:600; color:#ffd700;" id="dropdownUserName"></div>
                <div style="color:#8b949e; font-size:12px; margin-top:2px;" id="dropdownUserEmail"></div>
            </div>
            <button id="dropdownLogout" style="width:100%; padding:10px 16px; background:none; border:none; color:#f85149; font-size:14px; cursor:pointer; text-align:left; display:flex; align-items:center; gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Cerrar sesion
            </button>`;
        document.body.appendChild(dropdown);

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target.id !== 'authBtn') {
                dropdown.style.display = 'none';
            }
        });

        document.getElementById('dropdownLogout').addEventListener('click', async () => {
            dropdown.style.display = 'none';
            await signOut();
        });
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
        const submitBtn = document.getElementById('authSubmit');
        errEl.style.display = 'none';
        if (!email || !pass) { errEl.textContent = 'Email y contrasena son obligatorios'; errEl.style.display = 'block'; return; }
        submitBtn.disabled = true;
        submitBtn.textContent = _isSignUp ? 'Creando cuenta...' : 'Iniciando sesion...';
        try {
            if (_isSignUp) {
                await signUp(email, pass, name);
                closeAuthModal();
                showAuthToast('Cuenta creada. Revisa tu email para confirmar tu cuenta.', '#238636');
            } else {
                await signIn(email, pass);
                closeAuthModal();
                showAuthToast('Sesion iniciada correctamente!', '#238636');
            }
        } catch (e) {
            errEl.textContent = e.message;
            errEl.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = _isSignUp ? 'Crear cuenta' : 'Iniciar sesion';
        }
    };

    function showAuthToast(msg, color) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:99999; background:' + (color || '#161b22') + '; color:white; padding:14px 24px; border-radius:12px; font-size:14px; font-weight:500; box-shadow:0 4px 20px rgba(0,0,0,0.5); animation:fadeInUp 0.3s ease; max-width:90%; text-align:center;';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 3000);
        setTimeout(() => toast.remove(), 3500);
    }

    // Bind toggle links
    document.getElementById('authToggleLink')?.addEventListener('click', (e) => { e.preventDefault(); toggleAuthMode(); });
    document.getElementById('authSubmit')?.addEventListener('click', handleAuth);

    // Update nav auth button
    function updateAuthBtn(user) {
        const btn = document.getElementById('authBtn');
        const dropdown = document.getElementById('userDropdown');
        if (!btn) return;
        if (user) {
            const displayName = user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0] || 'Mi cuenta';
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' + displayName;
            btn.style.color = '#ffd700';
            btn.onclick = (e) => {
                e.stopPropagation();
                const isVisible = dropdown.style.display === 'block';
                dropdown.style.display = isVisible ? 'none' : 'block';
                document.getElementById('dropdownUserName').textContent = user.user_metadata?.full_name || displayName;
                document.getElementById('dropdownUserEmail').textContent = user.email || '';
            };
        } else {
            btn.innerHTML = 'Login';
            btn.style.color = '#ffd700';
            btn.onclick = openAuthModal;
            if (dropdown) dropdown.style.display = 'none';
        }
    }
    onAuthChange(updateAuthBtn);
})();
