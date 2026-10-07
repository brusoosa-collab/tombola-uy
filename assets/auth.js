(function () {
  "use strict";

  var config = window.TOMBOLA_SUPABASE;
  var supabaseClient = null;
  var session = null;
  var mode = "login";
  var el = {
    modal: document.getElementById("auth-modal"),
    open: document.getElementById("auth-open"),
    close: document.getElementById("auth-close"),
    form: document.getElementById("auth-form"),
    title: document.getElementById("auth-title"),
    intro: document.getElementById("auth-intro"),
    nameField: document.getElementById("auth-name-field"),
    name: document.getElementById("auth-name"),
    email: document.getElementById("auth-email"),
    password: document.getElementById("auth-password"),
    submit: document.getElementById("auth-submit"),
    message: document.getElementById("auth-message"),
    mode: document.getElementById("auth-mode"),
    reset: document.getElementById("auth-reset"),
    adminPanel: document.getElementById("administracion"),
    adminUsers: document.getElementById("admin-user-list"),
  };

  function init() {
    if (!config || !window.supabase || !window.supabase.createClient) {
      el.open.textContent = "Acceso no disponible";
      el.open.disabled = true;
      return;
    }

    supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
    el.open.addEventListener("click", function () {
      if (session) signOut();
      else openModal("login");
    });
    el.close.addEventListener("click", closeModal);
    document.querySelector("[data-auth-close]").addEventListener("click", closeModal);
    el.mode.addEventListener("click", function () {
      if (session) return signOut();
      setMode(mode === "login" ? "signup" : "login");
    });
    el.reset.addEventListener("click", resetPassword);
    el.form.addEventListener("submit", submitForm);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !el.modal.hidden) closeModal();
    });

    supabaseClient.auth.onAuthStateChange(function (_event, nextSession) {
      session = nextSession;
      updateHeader();
      if (session) closeModal();
      syncAndNotify();
    });
    supabaseClient.auth.getSession().then(function (result) {
      session = result.data.session;
      updateHeader();
      syncAndNotify();
    });
  }

  async function syncAndNotify() {
    var rows = [];
    var profile = null;
    var users = [];
    if (session) {
      await migrateLocalRecords(session.user.id);
      var result = await supabaseClient
        .from("picks")
        .select("*")
        .order("generated_at", { ascending: false });
      if (!result.error) rows = result.data || [];
      var profileResult = await supabaseClient
        .from("profiles")
        .select("id, email, display_name, role, created_at")
        .eq("id", session.user.id)
        .single();
      if (!profileResult.error) profile = profileResult.data;
      if (profile && profile.role === "admin") {
        var usersResult = await supabaseClient
          .from("profiles")
          .select("id, email, display_name, role, created_at")
          .order("created_at", { ascending: true });
        if (!usersResult.error) users = usersResult.data || [];
      }
    }
    renderAdmin(profile && profile.role === "admin", users);
    document.dispatchEvent(new CustomEvent("tombola-auth-change", {
      detail: { session: session, user: session ? session.user : null, picks: rows, profile: profile },
    }));
  }

  function renderAdmin(isAdmin, users) {
    if (!el.adminPanel) return;
    el.adminPanel.hidden = !isAdmin;
    if (!isAdmin) return;
    el.adminUsers.innerHTML = "";
    users.forEach(function (user) {
      var item = document.createElement("li");
      item.className = "admin-user-item";
      var info = document.createElement("span");
      info.textContent = (user.display_name || user.email) + " · " + user.role;
      item.appendChild(info);
      if (user.role !== "admin") {
        var remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Eliminar";
        remove.addEventListener("click", async function () {
          if (!window.confirm("¿Eliminar esta cuenta y sus jugadas?")) return;
          var result = await supabaseClient.rpc("admin_delete_user", { target_user: user.id });
          if (result.error) {
            el.message.textContent = friendlyError(result.error);
          } else {
            el.message.textContent = "Cuenta eliminada.";
            syncAndNotify();
          }
        });
        item.appendChild(remove);
      }
      el.adminUsers.appendChild(item);
    });
  }

  function localRecords() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem("tombola.tracking.records.v1") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function localGeneratedRecords() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem("tombola.generated.history.v1") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  async function migrateLocalRecords(userId) {
    var marker = "tombola.picks.migrated." + userId;
    if (window.localStorage.getItem(marker)) return;
    var records = localRecords();
    var generated = localGeneratedRecords();
    if (!records.length && !generated.length) {
      window.localStorage.setItem(marker, "1");
      return;
    }
    var rows = records.map(function (entry) {
      return {
        user_id: userId,
        target_date: entry.date,
        period: entry.period,
        strategy: entry.strategy,
        analysis_window: entry.window,
        quantity: entry.quantity,
        numbers: entry.numbers,
        generated_at: entry.recordedAt,
        tracked_at: entry.recordedAt,
        result_numbers: entry.resultNumbers,
        hits: Number.isInteger(entry.hits) ? entry.hits : null,
        resolved_at: entry.resolvedAt || null,
      };
    });
    generated.forEach(function (entry) {
      rows.push({
        user_id: userId,
        target_date: entry.date,
        period: entry.period,
        strategy: entry.strategy,
        analysis_window: entry.window,
        quantity: entry.quantity,
        numbers: entry.numbers,
        generated_at: entry.generatedAt,
        tracked_at: null,
      });
    });
    var result = await supabaseClient.from("picks").insert(rows);
    if (!result.error) window.localStorage.setItem(marker, "1");
  }

  async function savePick(record) {
    if (!session) return null;
    var result = await supabaseClient.from("picks").insert({
      user_id: session.user.id,
      target_date: record.date,
      period: record.period,
      strategy: record.strategy,
      analysis_window: record.window,
      quantity: record.quantity,
      numbers: record.numbers,
      generated_at: record.generatedAt || new Date().toISOString(),
      tracked_at: record.tracked ? new Date().toISOString() : null,
    }).select().single();
    return result.error ? null : result.data;
  }

  function openModal(nextMode) {
    setMode(nextMode || "login");
    el.modal.hidden = false;
    window.setTimeout(function () { el.email.focus(); }, 0);
  }

  function closeModal() {
    el.modal.hidden = true;
    el.message.textContent = "";
    el.form.reset();
  }

  function setMode(nextMode) {
    mode = nextMode;
    var signup = mode === "signup";
    el.title.textContent = signup ? "Crear cuenta" : "Iniciar sesión";
    el.intro.textContent = signup
      ? "Registrate para conservar tus jugadas en todos tus dispositivos."
      : "Accedé a tus jugadas desde cualquier dispositivo.";
    el.nameField.hidden = !signup;
    el.name.required = signup;
    el.password.autocomplete = signup ? "new-password" : "current-password";
    el.submit.textContent = signup ? "Crear cuenta" : "Entrar";
    el.mode.textContent = signup ? "Ya tengo una cuenta" : "Crear una cuenta";
    el.reset.hidden = signup;
    el.message.textContent = "";
  }

  async function submitForm(event) {
    event.preventDefault();
    el.submit.disabled = true;
    el.message.textContent = "Procesando…";
    var result;
    try {
      if (mode === "signup") {
        result = await supabaseClient.auth.signUp({
          email: el.email.value.trim(),
          password: el.password.value,
          options: { data: { display_name: el.name.value.trim() } },
        });
        if (result.error) throw result.error;
        el.message.textContent = result.data.session
          ? "Cuenta creada correctamente."
          : "Cuenta creada. Revisá tu correo para confirmar el registro.";
      } else {
        result = await supabaseClient.auth.signInWithPassword({
          email: el.email.value.trim(),
          password: el.password.value,
        });
        if (result.error) throw result.error;
        el.message.textContent = "Sesión iniciada.";
      }
    } catch (error) {
      el.message.textContent = friendlyError(error);
    } finally {
      el.submit.disabled = false;
    }
  }

  async function resetPassword() {
    var email = el.email.value.trim();
    if (!email) {
      el.message.textContent = "Escribí tu correo para recibir el enlace de recuperación.";
      el.email.focus();
      return;
    }
    var result = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    el.message.textContent = result.error
      ? friendlyError(result.error)
      : "Revisá tu correo para restablecer la contraseña.";
  }

  async function signOut() {
    var result = await supabaseClient.auth.signOut();
    if (result.error) el.message.textContent = friendlyError(result.error);
  }

  function updateHeader() {
    if (!session) {
      el.open.textContent = "Iniciar sesión";
      el.mode.textContent = "Crear una cuenta";
      return;
    }
    el.open.textContent = "Cerrar sesión";
    setMode("login");
  }

  function friendlyError(error) {
    var message = error && error.message ? error.message : "No se pudo completar la operación.";
    if (message.toLowerCase().indexOf("rate limit") !== -1) return "Demasiados intentos. Esperá unos minutos.";
    if (message.toLowerCase().indexOf("invalid login") !== -1) return "Correo o contraseña incorrectos.";
    if (message.toLowerCase().indexOf("already registered") !== -1) return "Ese correo ya tiene una cuenta.";
    if (message.indexOf("Se alcanzó el límite") !== -1) return "Ya se alcanzó el límite de 10 usuarios.";
    return message;
  }

  window.TOMBOLA_AUTH = {
    getClient: function () { return supabaseClient; },
    getSession: function () { return session; },
    savePick: savePick,
    open: openModal,
  };
  init();
})();
