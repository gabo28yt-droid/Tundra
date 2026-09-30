import { useCallback, useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "./firebase.js";

const NAV_ITEMS = [
  { id: "inicio", label: "Inicio", icon: "⌂" },
  { id: "tareas", label: "Tareas", icon: "☑" },
  { id: "calendario", label: "Calendario", icon: "▦" },
  { id: "rutinas", label: "Rutinas", icon: "◷" },
  { id: "finanzas", label: "Finanzas", icon: "↗" },
  { id: "pomodoro", label: "Pomodoro", icon: "◉" },
  { id: "estudio", label: "Estudio", icon: "✳" },
];
const COLORS = ["#8765e8", "#f08aa4", "#f6b74d", "#4dbdae", "#6d9ce9", "#f28a50"];
const CATEGORIES = ["Estudio", "Hogar", "Trabajo", "Personal"];
const EMPTY_LIST = [];
const DEFAULT_TIMER_SETTINGS = { focus: 25, short: 5, long: 15, cycles: 3 };

function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftDate(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function eventOccursOn(event, date) {
  const target = dateKey(date);
  if (target < event.date) return false;
  if (event.repeat === "Diario") return true;
  if (event.repeat === "Semanal") {
    return new Date(`${target}T00:00:00`).getDay() === new Date(`${event.date}T00:00:00`).getDay();
  }
  if (event.repeat === "Mensual") {
    return new Date(`${target}T00:00:00`).getDate() === new Date(`${event.date}T00:00:00`).getDate();
  }
  return target === event.date;
}
function formatDate(date, options = { weekday: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("es-MX", options).format(date);
}
function money(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}
function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setAuthError("");
    }, (error) => {
      setAuthError(error.message);
      setAuthReady(true);
    });
  }, []);

  if (!authReady) return <LoadingScreen message="Conectando con tu espacio personal..." />;
  if (!firebaseConfigured) return <AuthPage configurationMissing />;
  if (authError) return <AuthPage externalError={authError} />;
  if (!user) return <AuthPage />;
  return <PersonalApp key={user.uid} user={user} />;
}

function useCloudState(uid, key, initialValue) {
  const storageKey = `mia:${uid}:${key}`;
  const [value, setValue] = useState(() => readStore(storageKey, initialValue));
  const valueRef = useRef(value);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const reference = doc(db, "users", uid, "data", key);
    return onSnapshot(reference, (snapshot) => {
      if (snapshot.exists()) {
        const remoteValue = snapshot.data().value;
        if (JSON.stringify(remoteValue) !== JSON.stringify(valueRef.current)) {
          valueRef.current = remoteValue;
          setValue(remoteValue);
        }
      } else {
        const localValue = readStore(storageKey, initialValue);
        valueRef.current = localValue;
        setValue(localValue);
        setDoc(reference, { value: localValue, updatedAt: serverTimestamp() })
          .catch((writeError) => setError(writeError.message));
      }
      setError("");
      setLoaded(true);
    }, (readError) => {
      setError(readError.message);
      setLoaded(true);
    });
  }, [uid, key, storageKey, initialValue]);

  useEffect(() => {
    if (loaded) localStorage.setItem(storageKey, JSON.stringify(value));
  }, [loaded, storageKey, value]);

  const updateValue = useCallback((nextValue) => {
    const resolvedValue = typeof nextValue === "function" ? nextValue(valueRef.current) : nextValue;
    valueRef.current = resolvedValue;
    setValue(resolvedValue);
    setDoc(doc(db, "users", uid, "data", key), { value: resolvedValue, updatedAt: serverTimestamp() })
      .catch((writeError) => setError(writeError.message));
  }, [uid, key]);

  return [value, updateValue, loaded, error];
}

function PersonalApp({ user }) {
  const [active, setActive] = useState("inicio");
  const [tasks, setTasks, tasksLoaded, tasksError] = useCloudState(user.uid, "tasks", EMPTY_LIST);
  const [events, setEvents, eventsLoaded, eventsError] = useCloudState(user.uid, "events", EMPTY_LIST);
  const [routines, setRoutines, routinesLoaded, routinesError] = useCloudState(user.uid, "routines", EMPTY_LIST);
  const [transactions, setTransactions, transactionsLoaded, transactionsError] = useCloudState(user.uid, "transactions", EMPTY_LIST);
  const [studyStreak, setStudyStreak, streakLoaded, streakError] = useCloudState(user.uid, "study-streak", 0);
  const [studyDate, setStudyDate, studyDateLoaded, studyDateError] = useCloudState(user.uid, "study-date", "");
  const [modal, setModal] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [period, setPeriod] = useState("Hoy");
  const [toast, setToast] = useState("");
  const [timerSettings, setTimerSettings, timerLoaded, timerError] = useCloudState(user.uid, "timer-settings", DEFAULT_TIMER_SETTINGS);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);
  function navigate(id) {
    setActive(id);
    setModal("");
  }
  const pendingTasks = tasks.filter((task) => !task.done);
  const todayKey = dateKey(new Date());
  const cloudError = tasksError || eventsError || routinesError || transactionsError || streakError || studyDateError || timerError;
  if (![tasksLoaded, eventsLoaded, routinesLoaded, transactionsLoaded, streakLoaded, studyDateLoaded, timerLoaded].every(Boolean)) {
    return <LoadingScreen message="Cargando tus datos personales..." />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("inicio"); }}>
          <span className="brand-mark">T<span>✦</span></span>
          <span className="brand-name">Tundra<small>tu espacio personal</small></span>
        </a>
        <div className="side-label">MENÚ PRINCIPAL</div>
        <nav className="navigation" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => (
            <button className={`nav-item ${active === item.id ? "active" : ""}`} key={item.id} onClick={() => navigate(item.id)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id === "tareas" && <span className="nav-count">{pendingTasks.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="side-tip">
          <div className="tip-spark">✦</div>
          <strong>Un paso a la vez</strong>
          <p>Lo importante no es hacerlo todo, sino avanzar cada día.</p>
          <span>— Tu asistente ✨</span>
        </div>
        <button className="profile" onClick={() => signOut(auth).catch((error) => notify(authErrorMessage(error)))}>
          {user.photoURL ? <img className="avatar profile-photo" src={user.photoURL} alt="" /> : <span className="avatar">{(user.displayName || user.email || "U").slice(0, 1).toUpperCase()}</span>}<span className="profile-text"><strong>{user.displayName || "Mi cuenta"}</strong><small>Cerrar sesión</small></span><span className="dots">↪</span>
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Mi espacio</span><i>/</i><strong>{NAV_ITEMS.find((item) => item.id === active)?.label}</strong></div>
          <div className="top-actions">
            <span className="today-label">{formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</span>
            <button className="icon-button notification-button" aria-label="Notificaciones" onClick={() => notify("Estás al día. No tienes notificaciones nuevas.")}>♧<b /></button>
          </div>
        </header>
        <div className="page-wrap">
          {active === "inicio" && <Dashboard name={user.displayName?.split(" ")[0] || "qué gusto verte"} tasks={tasks} events={events} routines={routines} transactions={transactions} onNavigate={navigate} onToggleTask={(id) => setTasks(tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task))} />}
          {active === "tareas" && <TasksPage tasks={tasks} setTasks={setTasks} period={period} setPeriod={setPeriod} onAdd={() => setModal("task")} />}
          {active === "calendario" && <CalendarPage events={events} setEvents={setEvents} tasks={tasks} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onAdd={() => setModal("event")} />}
          {active === "rutinas" && <RoutinesPage routines={routines} setRoutines={setRoutines} onAdd={() => setModal("routine")} />}
          {active === "finanzas" && <FinancePage transactions={transactions} onAdd={() => setModal("transaction")} />}
          {active === "pomodoro" && <PomodoroPage settings={timerSettings} setSettings={setTimerSettings} notify={notify} />}
          {active === "estudio" && <StudyPage streak={studyStreak} setStreak={setStudyStreak} studiedToday={studyDate} setStudiedToday={setStudyDate} notify={notify} />}
        </div>
        {cloudError && <div className="cloud-error" role="alert"><strong>No se pudieron sincronizar tus datos.</strong><span>Revisa que Firestore esté habilitado y que las reglas de <code>firestore.rules</code> estén publicadas. {cloudError}</span></div>}
      </main>

      {modal && <EntryModal type={modal} onClose={() => setModal("")} onSave={(data) => {
        const id = Date.now();
        if (modal === "task") setTasks([{ id, ...data, done: false }, ...tasks]);
        if (modal === "event") setEvents([{ id, ...data }, ...events]);
        if (modal === "routine") setRoutines([{ id, ...data, done: false }, ...routines]);
        if (modal === "transaction") setTransactions([{ id, ...data }, ...transactions]);
        setModal("");
        notify("¡Listo! Se guardó correctamente.");
      }} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
      <nav className="mobile-nav" aria-label="Navegación principal">
        {NAV_ITEMS.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined}><span>{item.icon}</span>{item.label}</button>)}
      </nav>
      <span className="sr-only">{todayKey}</span>
    </div>
  );
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Inicia sesión.",
    "auth/invalid-email": "El correo electrónico no tiene un formato válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-credential": "El correo o la contraseña no son correctos.",
    "auth/user-not-found": "No encontramos una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña no es correcta.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de terminar.",
    "auth/popup-blocked": "Tu navegador bloqueó la ventana. Permite ventanas emergentes e inténtalo de nuevo.",
    "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase Authentication.",
    "auth/operation-not-allowed": "Activa este método de inicio de sesión en Firebase Console > Authentication > Sign-in method.",
    "auth/configuration-not-found": "No está configurado este método de inicio de sesión. Activa Google o Correo/contraseña en Firebase Console > Authentication.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "La clave web de Firebase no es válida o está restringida. Revisa la clave de la app web en Firebase y sus restricciones de API.",
    "auth/too-many-requests": "Hubo demasiados intentos. Espera un momento antes de volver a intentarlo.",
    "auth/network-request-failed": "No se pudo conectar. Revisa tu conexión a internet.",
  };
  const explanation = messages[error.code] || "No se pudo completar el acceso. Revisa la configuración de Firebase e inténtalo de nuevo.";
  return error.code ? `${explanation} (Código: ${error.code})` : explanation;
}

function AuthPage({ configurationMissing = false, externalError = "" }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (mode === "register") {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
        try {
          await sendEmailVerification(credential.user);
          setMessage("Cuenta creada. Te enviamos un correo para verificar tu dirección.");
        } catch {
          setMessage("Cuenta creada correctamente. Puedes empezar a organizarte.");
        }
      } else if (mode === "reset") {
        await sendPasswordResetEmail(auth, email.trim());
        setMessage("Te enviamos un enlace para cambiar tu contraseña.");
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (submitError) {
      setError(authErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (loginError) {
      setError(authErrorMessage(loginError));
    } finally {
      setBusy(false);
    }
  }

  if (configurationMissing) {
    return <div className="auth-page"><section className="auth-card auth-config"><Brand /><span className="eyebrow">CONFIGURACIÓN NECESARIA</span><h1>Falta la configuración de Firebase</h1><p>Crea un archivo <code>.env.local</code> en la carpeta del proyecto con las variables de Firebase indicadas en <code>.env.example</code>, y vuelve a iniciar Vite.</p></section></div>;
  }

  return <div className="auth-page">
    <section className="auth-card">
      <div className="auth-brand-row"><Brand /><span className="auth-decoration">✦</span></div>
      <span className="eyebrow">{mode === "register" ? "EMPIEZA A TU MANERA" : mode === "reset" ? "RECUPERA TU ACCESO" : "QUÉ BUENO VERTE"}</span>
      <h1>{mode === "register" ? "Crea tu espacio." : mode === "reset" ? "Recupera tu cuenta." : "Tu día, más claro."}</h1>
      <p className="auth-subtitle">{mode === "register" ? "Regístrate y guarda tus planes en tu cuenta personal." : mode === "reset" ? "Te enviaremos un enlace para crear una nueva contraseña." : "Inicia sesión para continuar con tus tareas y rutinas."}</p>
      {(error || externalError) && <div className="auth-alert" role="alert">{error || externalError}</div>}
      {message && <div className="auth-success" role="status">{message}</div>}
      {mode !== "reset" && <button type="button" className="google-button" onClick={continueWithGoogle} disabled={busy}><GoogleMark />Continuar con Google</button>}
      {mode !== "reset" && <div className="auth-divider"><span>o usa tu correo</span></div>}
      <form className="auth-form" onSubmit={submit}>
        {mode === "register" && <label>Nombre<input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="¿Cómo te llamas?" /></label>}
        <label>Correo electrónico<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" /></label>
        {mode !== "reset" && <label>Contraseña<input autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Al menos 6 caracteres" />{mode === "login" && <button className="forgot-link" type="button" onClick={() => { setMode("reset"); setError(""); setMessage(""); }}>¿Olvidaste tu contraseña?</button>}</label>}
        <button className="button auth-submit" type="submit" disabled={busy}>{busy ? "Un momento..." : mode === "register" ? "Crear cuenta" : mode === "reset" ? "Enviar enlace" : "Iniciar sesión"}</button>
      </form>
      <div className="auth-switch">{mode === "register" ? <>¿Ya tienes cuenta? <button onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Inicia sesión</button></> : <>¿Aún no tienes cuenta? <button onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Regístrate</button></>}</div>
      {mode === "reset" && <button className="back-login" onClick={() => { setMode("login"); setError(""); setMessage(""); }}>← Volver a iniciar sesión</button>}
      <p className="auth-privacy">Al continuar, tus datos se guardan de forma privada en tu cuenta.</p>
    </section>
    <div className="auth-side-art"><div className="auth-art-orbit" /><div className="auth-art-star">✦</div><div className="auth-art-sun"><i /><i /><b /></div><span>Un espacio pensado para ti.</span><small>ORGANIZA · RESPIRA · AVANZA</small></div>
  </div>;
}

function Brand() {
  return <a className="brand auth-brand" href="#" onClick={(event) => event.preventDefault()}><span className="brand-mark">T<span>✦</span></span><span className="brand-name">Tundra<small>tu espacio personal</small></span></a>;
}

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" /><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.93c-.58 2.96-2.26 5.47-4.76 7.17l7.27 5.64c4.25-3.92 6.7-9.7 6.7-17.28Z" /><path fill="#4A90E2" d="M9.53 28.59A14.4 14.4 0 0 1 8.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.88.93 7.56 2.56 10.78l6.97-6.19Z" transform="translate(0 0)" /><path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.27-5.64c-2.01 1.35-4.58 2.15-8.63 2.15-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -4)" /></svg>;
}

function LoadingScreen({ message }) {
  return <div className="loading-page"><span className="loading-mark">m<span>✦</span></span><strong>{message}</strong><i /></div>;
}

function PageHeading({ eyebrow, title, subtitle, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
function SectionTitle({ title, action }) {
  return <div className="section-title"><h2>{title}</h2>{action}</div>;
}
function Button({ children, onClick, secondary = false, className = "" }) {
  return <button type="button" className={`button ${secondary ? "button-secondary" : ""} ${className}`} onClick={onClick}>{children}</button>;
}
function Dashboard({ name, tasks, events, routines, transactions, onNavigate, onToggleTask }) {
  const openTasks = tasks.filter((task) => !task.done);
  const completed = tasks.filter((task) => task.done).length;
  const income = transactions.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.amount), 0);
  const expenses = transactions.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.amount), 0);
  const todayEvents = events.filter((event) => eventOccursOn(event, new Date())).sort((a, b) => a.start.localeCompare(b.start));
  const activeRoutines = routines.filter((routine) => routine.days.includes((new Date().getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, index) => shiftDate(mondayOf(new Date()), index));
  return <>
    <PageHeading eyebrow={formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} title={<>Hola, {name} <span className="wave">✦</span></>} subtitle="Un día tranquilo también puede ser un día productivo. ¿Qué te gustaría lograr?" action={<Button onClick={() => onNavigate("tareas")}>＋ Nueva tarea</Button>} />
    <div className="welcome-card">
      <div className="welcome-copy"><span className="welcome-tag">TU ESPACIO, A TU RITMO</span><h2>Pequeños pasos,<br />grandes cambios.</h2><p>Hoy tienes <strong>{openTasks.length} tareas</strong> por delante. Elige una y empieza por ahí.</p><button onClick={() => onNavigate("tareas")}>Ver mis tareas <span>→</span></button></div>
      <div className="welcome-art"><span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" /><div className="sun-face"><i /><i /><b /></div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span><span className="art-cloud">☁</span><span className="art-ground" /></div>
      <div className="welcome-pagination"><i className="selected" /><i /><i /></div>
    </div>
    <div className="overview-grid">
      <div className="stat-card"><span className="stat-icon lilac">☑</span><div><span>Tareas pendientes</span><strong>{openTasks.length}<small> tareas</small></strong></div><span className="stat-note">↗ {completed} completadas</span></div>
      <div className="stat-card"><span className="stat-icon mint">◷</span><div><span>Rutinas de hoy</span><strong>{activeRoutines.length}<small> actividades</small></strong></div><span className="stat-note">Tu día en equilibrio</span></div>
      <div className="stat-card"><span className="stat-icon peach">↗</span><div><span>Balance disponible</span><strong>{money(income - expenses)}</strong></div><span className="stat-note">Este mes</span></div>
    </div>
    <div className="dashboard-grid">
      <section className="panel tasks-panel"><SectionTitle title="Lo más importante" action={<button className="text-link" onClick={() => onNavigate("tareas")}>Ver todas <span>→</span></button>} />
        <div className="mini-task-list">{openTasks.slice(0, 4).map((task) => <button className="mini-task" key={task.id} onClick={() => onToggleTask(task.id)}><span className="checkbox" /><span className="task-color" style={{ background: task.color }} /><span className="mini-task-copy"><strong>{task.title}</strong><small>{task.category} · {task.due === dateKey(new Date()) ? "Hoy" : "Próximamente"}</small></span><span className={`priority-dot ${task.priority.toLowerCase()}`} /></button>)}
          {openTasks.length === 0 && <EmptyState title="Todo listo por hoy" text="Disfruta el espacio que has creado." />}
        </div>
      </section>
      <section className="panel week-panel"><SectionTitle title="Esta semana" action={<button className="text-link" onClick={() => onNavigate("calendario")}>Calendario <span>→</span></button>} />
        <div className="week-strip">{week.map((day) => { const isToday = dateKey(day) === dateKey(new Date()); const hasEvent = events.some((event) => event.date === dateKey(day)); return <button key={dateKey(day)} className={`week-day ${isToday ? "today" : ""}`} onClick={() => onNavigate("calendario")}><span>{formatDate(day, { weekday: "narrow" })}</span><strong>{day.getDate()}</strong>{hasEvent && <i />}</button>; })}</div>
        <div className="agenda-preview">{todayEvents.slice(0, 2).map((event) => <div className="agenda-line" key={event.id}><time>{event.start}</time><span style={{ background: event.color }} /><strong>{event.title}</strong></div>)}{todayEvents.length === 0 && <p className="muted-copy">No tienes eventos programados para hoy.</p>}</div>
      </section>
      <section className="panel routine-panel"><SectionTitle title="Tu rutina de hoy" action={<button className="text-link" onClick={() => onNavigate("rutinas")}>Ver rutina <span>→</span></button>} />
        <div className="routine-preview">{activeRoutines.slice(0, 3).map((routine) => <div className="routine-line" key={routine.id}><span className={`routine-check ${routine.doneDate === dateKey(new Date()) ? "checked" : ""}`}>{routine.doneDate === dateKey(new Date()) ? "✓" : ""}</span><span className="routine-time">{routine.time}</span><span>{routine.title}</span></div>)}{activeRoutines.length === 0 && <p className="muted-copy">Aún no hay rutinas para hoy.</p>}</div>
      </section>
      <section className="panel focus-card"><div className="focus-decoration">✳</div><span className="eyebrow">UN MOMENTO PARA TI</span><h2>Enfócate en<br />una cosa a la vez.</h2><p>25 minutos de concentración pueden cambiar tu día.</p><Button secondary onClick={() => onNavigate("pomodoro")}>Comenzar Pomodoro <span>→</span></Button></section>
    </div>
  </>;
}
function EmptyState({ title, text }) {
  return <div className="empty-state"><span>✳</span><strong>{title}</strong><p>{text}</p></div>;
}
function TasksPage({ tasks, setTasks, period, setPeriod, onAdd }) {
  const filters = ["Hoy", "Esta semana", "Todas"];
  const now = new Date();
  const filtered = tasks.filter((task) => {
    if (period === "Hoy") return task.due === dateKey(now);
    if (period === "Esta semana") { const start = mondayOf(now); const end = shiftDate(start, 7); const d = new Date(`${task.due}T00:00:00`); return d >= start && d < end; }
    return true;
  });
  const groups = ["Alta", "Media", "Baja"];
  const complete = (id) => setTasks(tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task));
  const remove = (id) => setTasks(tasks.filter((task) => task.id !== id));
  return <>
    <PageHeading eyebrow="ORGANIZA TU DÍA" title="Tareas" subtitle="Todo lo que quieres hacer, en un lugar más claro." action={<Button onClick={onAdd}>＋ Nueva tarea</Button>} />
    <div className="filter-row">{filters.map((filter) => <button key={filter} className={`filter-pill ${period === filter ? "selected" : ""}`} onClick={() => setPeriod(filter)}>{filter}{filter === "Todas" && <span>{tasks.filter((task) => !task.done).length}</span>}</button>)}<span className="filter-spacer" /><span className="category-hint"><i /> Por prioridad</span></div>
    <div className="task-board">
      <div className="task-column">
        {groups.map((group) => {
          const items = filtered.filter((task) => !task.done && task.priority === group);
          return <section className="task-group" key={group}><div className="group-heading"><div><i className={`priority-dot ${group.toLowerCase()}`} /><h2>{group} prioridad</h2><span className="group-count">{items.length}</span></div><button aria-label={`Agregar tarea de prioridad ${group}`} onClick={onAdd}>＋</button></div>
            <div className="task-cards">{items.map((task) => <article className="task-card" key={task.id}><button className="checkbox" aria-label="Marcar como completada" onClick={() => complete(task.id)} /><span className="task-color" style={{ background: task.color }} /><div className="task-card-copy"><strong>{task.title}</strong><span>{task.category} <i>·</i> {task.due === dateKey(now) ? "Hoy" : formatDate(new Date(`${task.due}T00:00:00`), { weekday: "short", day: "numeric", month: "short" })}</span></div><button className="delete-button" aria-label="Eliminar tarea" onClick={() => remove(task.id)}>×</button></article>)}
              {items.length === 0 && <button className="add-inline" onClick={onAdd}>＋ Agregar tarea</button>}
            </div>
          </section>;
        })}
      </div>
      <aside className="task-sidebar panel"><span className="eyebrow">TU PROGRESO</span><div className="progress-ring" style={{ "--progress": `${tasks.length ? tasks.filter((task) => task.done).length / tasks.length * 100 : 0}%` }}><div><strong>{tasks.length ? Math.round(tasks.filter((task) => task.done).length / tasks.length * 100) : 0}%</strong><span>completado</span></div></div><p>Vas a tu propio ritmo. Cada tarea terminada cuenta.</p><div className="sidebar-divider" /><div className="progress-stats"><span>Por hacer <strong>{tasks.filter((task) => !task.done).length}</strong></span><span>Completadas <strong>{tasks.filter((task) => task.done).length}</strong></span></div>
        <div className="completed-tasks"><h3>Completadas</h3>{tasks.filter((task) => task.done).slice(0, 4).map((task) => <button key={task.id} onClick={() => complete(task.id)}><span className="completed-check">✓</span><s>{task.title}</s></button>)}{tasks.filter((task) => task.done).length === 0 && <span className="muted-copy">Aquí aparecerán tus logros.</span>}</div></aside>
    </div>
  </>;
}
function CalendarPage({ events, setEvents, tasks, selectedDate, setSelectedDate, onAdd }) {
  const [view, setView] = useState("Semana");
  const weekStart = mondayOf(selectedDate);
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthGridStart = mondayOf(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, index) => shiftDate(monthGridStart, index));
  const visibleDays = view === "Día" ? [selectedDate] : days;
  const date = dateKey(selectedDate);
  const selectedEvents = events.filter((event) => eventOccursOn(event, selectedDate)).sort((a, b) => a.start.localeCompare(b.start));
  const selectedTasks = tasks.filter((task) => task.due === date && !task.done);
  function changeCalendar(direction) {
    if (view === "Día") setSelectedDate(shiftDate(selectedDate, direction));
    else if (view === "Mes") setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + direction, Math.min(selectedDate.getDate(), new Date(selectedDate.getFullYear(), selectedDate.getMonth() + direction + 1, 0).getDate())));
    else setSelectedDate(shiftDate(selectedDate, direction * 7));
  }
  return <>
    <PageHeading eyebrow="TU TIEMPO, BIEN APROVECHADO" title="Calendario" subtitle="Haz espacio para lo importante y recuerda respirar entre cada plan." action={<Button onClick={onAdd}>＋ Nuevo evento</Button>} />
    <div className="calendar-toolbar"><div className="view-switch">{["Mes", "Semana", "Día"].map((item) => <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item}</button>)}</div><div className="calendar-nav"><button className="icon-button" onClick={() => changeCalendar(-1)}>‹</button><strong>{new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(selectedDate)}</strong><button className="icon-button" onClick={() => changeCalendar(1)}>›</button><button className="today-button" onClick={() => setSelectedDate(new Date())}>Hoy</button></div></div>
    <div className={`calendar-card panel ${view === "Día" ? "day-view" : ""}`}>
      {view === "Mes" ? <div className="month-calendar"><div className="month-weekdays">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{monthDays.map((day) => { const key = dateKey(day); const dayEvents = events.filter((event) => eventOccursOn(event, day)); const dayTasks = tasks.filter((task) => task.due === key && !task.done); return <button key={key} className={`month-cell ${day.getMonth() === selectedDate.getMonth() ? "" : "outside"} ${key === date ? "selected" : ""} ${key === dateKey(new Date()) ? "is-today" : ""}`} onClick={() => { setSelectedDate(day); setView("Día"); }}><strong>{day.getDate()}</strong><span className="month-markers">{dayEvents.slice(0, 3).map((event) => <i key={event.id} style={{ background: event.color }} />)}{dayTasks.length > 0 && <b />}</span></button>; })}</div></div> : <>
        <div className="calendar-week-head" style={{ gridTemplateColumns: `47px repeat(${visibleDays.length}, minmax(0, 1fr))` }}><div className="time-spacer" />{visibleDays.map((day) => <button key={dateKey(day)} className={`calendar-day-head ${dateKey(day) === date ? "selected" : ""} ${dateKey(day) === dateKey(new Date()) ? "is-today" : ""}`} onClick={() => setSelectedDate(day)}><span>{formatDate(day, { weekday: "short" })}</span><strong>{day.getDate()}</strong><i className="calendar-dot" /></button>)}</div>
        <div className="calendar-body" style={{ gridTemplateColumns: `47px repeat(${visibleDays.length}, minmax(0, 1fr))` }}><div className="time-column">{["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"].map((time) => <span key={time}>{time}</span>)}</div>
        {visibleDays.map((day) => {
          const dayEvents = events.filter((event) => eventOccursOn(event, day));
          const dayTasks = tasks.filter((task) => task.due === dateKey(day) && !task.done);
          return <div className="calendar-day-column" key={dateKey(day)}>{Array.from({ length: 10 }, (_, index) => <div className="hour-cell" key={index} />)}
            {dayEvents.map((event) => <button key={event.id} className="event-block" style={{ "--event-color": event.color, top: `calc(${(((Number(event.start.slice(0, 2)) - 8) * 60) + Number(event.start.slice(3, 5))) / 600 * 100}% + 6px)` }} onClick={() => { if (window.confirm(`¿Eliminar "${event.title}" del calendario?`)) setEvents(events.filter((item) => item.id !== event.id)); }}><strong>{event.title}</strong><span>{event.start} – {event.end}</span>{event.note && <small>{event.note}</small>}</button>)}
            {dayTasks.map((task) => <div className="calendar-task-chip" key={task.id} style={{ "--event-color": task.color }}><span>□</span>{task.title}</div>)}
          </div>;
        })}</div>
      </>}
    </div>
    <div className="calendar-footnote"><span className="legend-color" /> Evento <span className="legend-outline">□</span> Tarea <span className="calendar-note">Selecciona un evento para eliminarlo</span></div>
    <section className="panel agenda-panel"><SectionTitle title={`Agenda · ${formatDate(selectedDate, { weekday: "long", day: "numeric", month: "long" })}`} action={<button className="text-link" onClick={onAdd}>＋ Añadir</button>} />
      <div className="agenda-list">{selectedEvents.map((event) => <div className="agenda-item" key={event.id}><time>{event.start}</time><span className="agenda-color" style={{ background: event.color }} /><div><strong>{event.title}</strong><small>{event.start} – {event.end}{event.repeat !== "Nunca" ? ` · ${event.repeat}` : ""}{event.note ? ` · ${event.note}` : ""}</small></div><button className="delete-button" onClick={() => setEvents(events.filter((item) => item.id !== event.id))}>×</button></div>)}{selectedTasks.map((task) => <div className="agenda-item" key={`task-${task.id}`}><time>—</time><span className="agenda-color" style={{ background: task.color }} /><div><strong>{task.title}</strong><small>Tarea · {task.category}</small></div></div>)}{selectedEvents.length + selectedTasks.length === 0 && <p className="muted-copy">Un día abierto para lo que surja.</p>}</div>
    </section>
  </>;
}
function RoutinesPage({ routines, setRoutines, onAdd }) {
  const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const [selectedDay, setSelectedDay] = useState((new Date().getDay() + 6) % 7);
  const selectedDateKey = dateKey(shiftDate(mondayOf(new Date()), selectedDay));
  const todays = routines.filter((routine) => routine.days.includes(selectedDay)).sort((a, b) => a.time.localeCompare(b.time));
  const completedCount = todays.filter((routine) => routine.doneDate === selectedDateKey).length;
  const toggleDone = (id) => setRoutines(routines.map((routine) => routine.id === id ? { ...routine, doneDate: routine.doneDate === selectedDateKey ? "" : selectedDateKey } : routine));
  return <>
    <PageHeading eyebrow="HÁBITOS QUE TE CUIDAN" title="Rutinas" subtitle="Una estructura flexible que se adapta a tu vida, no al revés." action={<Button onClick={onAdd}>＋ Nueva rutina</Button>} />
    <section className="panel routine-week-card"><div className="routine-week-title"><div><span className="eyebrow">SEMANA ACTUAL</span><h2>Tu ritmo, día a día</h2></div><span className="week-number">Semana {Math.ceil(new Date().getDate() / 7)}</span></div>
      <div className="routine-day-picker">{days.map((day, index) => <button key={day} className={selectedDay === index ? "selected" : ""} onClick={() => setSelectedDay(index)}><span>{day}</span><strong>{shiftDate(mondayOf(new Date()), index).getDate()}</strong><i>{routines.some((routine) => routine.days.includes(index)) ? "•" : ""}</i></button>)}</div>
    </section>
    <div className="routine-layout"><section className="panel routine-timeline"><SectionTitle title={selectedDay === (new Date().getDay() + 6) % 7 ? "Tu plan de hoy" : `Plan para el ${days[selectedDay]}`} action={<span className="routine-total">{completedCount} / {todays.length} completadas</span>} />
      {todays.length === 0 ? <EmptyState title="Un día para improvisar" text="No tienes una rutina establecida para este día." /> : <div className="timeline">{todays.map((routine) => { const done = routine.doneDate === selectedDateKey; return <div className={`timeline-item ${done ? "done" : ""}`} key={routine.id}><time>{routine.time}</time><span className="timeline-dot" style={{ background: routine.color }} /><div className="timeline-content"><strong>{routine.title}</strong><small>{done ? "¡Completado! Buen trabajo." : "Toma este momento para ti"}</small></div><button className={`routine-done ${done ? "checked" : ""}`} onClick={() => toggleDone(routine.id)} aria-label="Marcar rutina como completada">{done ? "✓" : ""}</button><button className="delete-button" aria-label="Eliminar rutina" onClick={() => setRoutines(routines.filter((item) => item.id !== routine.id))}>×</button></div>; })}</div>}
    </section><aside className="routine-aside"><div className="routine-quote"><span>“</span><p>La rutina no es una jaula. Es el espacio que creas para lo que te hace bien.</p><small>RECUERDA</small><i>✳</i></div><div className="routine-summary panel"><span className="eyebrow">ESTA SEMANA</span><strong>{routines.length}<small> rutinas activas</small></strong><p>Pequeños rituales para días más ligeros.</p></div></aside></div>
  </>;
}
function FinancePage({ transactions, onAdd }) {
  const income = transactions.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.amount), 0);
  const expenses = transactions.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.amount), 0);
  const expenseGroups = Object.entries(transactions.filter((item) => item.type === "expense").reduce((groups, item) => { groups[item.category] = (groups[item.category] || 0) + Number(item.amount); return groups; }, {})).sort((a, b) => b[1] - a[1]);
  const colors = [COLORS[0], COLORS[1], COLORS[2], COLORS[3], COLORS[4]];
  const circumference = 2 * Math.PI * 58;
  let offset = 0;
  return <>
    <PageHeading eyebrow="CLARIDAD PARA DECIDIR" title="Finanzas" subtitle="Observa cómo se mueve tu dinero, sin juicios y a tu manera." action={<Button onClick={onAdd}>＋ Nuevo movimiento</Button>} />
    <div className="finance-summary-grid"><div className="balance-card"><span>Balance disponible</span><strong>{money(income - expenses)}</strong><small>Ingresos menos gastos registrados</small><div className="balance-shape shape-a" /><div className="balance-shape shape-b" /><span className="balance-star">✳</span></div><div className="finance-stat income-stat"><span className="finance-symbol">↙</span><span>Ingresos</span><strong>{money(income)}</strong><small>Este mes</small></div><div className="finance-stat expense-stat"><span className="finance-symbol">↗</span><span>Gastos</span><strong>{money(expenses)}</strong><small>Este mes</small></div></div>
    <div className="finance-grid"><section className="panel spending-panel"><SectionTitle title="¿En qué se va?" action={<span className="muted-copy">Gastos por categoría</span>} />
      {expenseGroups.length === 0 ? <EmptyState title="Aún no hay gastos" text="Agrega un movimiento para ver el resumen." /> : <div className="spending-content"><div className="donut-wrap"><svg viewBox="0 0 150 150" role="img" aria-label="Gráfica de gastos por categoría"><circle cx="75" cy="75" r="58" fill="none" stroke="#f1eff6" strokeWidth="16" />{expenseGroups.map(([category, amount], index) => { const length = expenses ? amount / expenses * circumference : 0; const circle = <circle key={category} cx="75" cy="75" r="58" fill="none" stroke={colors[index % colors.length]} strokeWidth="16" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 75 75)" strokeLinecap="round" />; offset += length; return circle; })}</svg><div className="donut-label"><strong>{money(expenses)}</strong><span>total de gastos</span></div></div><div className="category-legend">{expenseGroups.map(([category, amount], index) => <div key={category}><i style={{ background: colors[index % colors.length] }} /><span>{category}</span><strong>{money(amount)}</strong></div>)}</div></div>}
    </section><section className="panel transactions-panel"><SectionTitle title="Movimientos recientes" action={<button className="text-link" onClick={onAdd}>＋ Añadir</button>} />
      <div className="transaction-list">{transactions.slice(0, 6).map((item) => <div className="transaction-item" key={item.id}><span className={`transaction-icon ${item.type}`}>{item.type === "income" ? "↙" : "↗"}</span><div><strong>{item.title}</strong><small>{item.category} · {formatDate(new Date(`${item.date}T00:00:00`), { day: "numeric", month: "short" })}</small></div><b className={item.type}>{item.type === "income" ? "+" : "−"}{money(item.amount)}</b></div>)}{transactions.length === 0 && <EmptyState title="Tu historial empieza aquí" text="Registra tu primer ingreso o gasto." />}</div>
    </section></div>
    <div className="finance-footnote"><span>✦</span> Tu información financiera se guarda solo en este dispositivo.</div>
  </>;
}
function PomodoroPage({ settings, setSettings, notify }) {
  const [mode, setMode] = useState("focus");
  const [secondsLeft, setSecondsLeft] = useState(settings.focus * 60);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [completion, setCompletion] = useState("");
  const [preset, setPreset] = useState("25 / 5");
  const longBreak = cycles > 0 && cycles % settings.cycles === 0;
  const breakMinutes = longBreak ? settings.long : settings.short;
  const totalSeconds = (mode === "focus" ? settings.focus : breakMinutes) * 60;
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!running || secondsLeft !== 0) return;
    setRunning(false);
    if (mode === "focus") setCycles((count) => count + 1);
    setCompletion(mode);
    notify(mode === "focus" ? "¡Sesión terminada! Tómate un descanso." : "Descanso terminado. ¿Listo para enfocarte?");
  }, [secondsLeft, running, mode, notify]);
  function switchMode(nextMode) { setRunning(false); setCompletion(""); setMode(nextMode); setSecondsLeft((nextMode === "focus" ? settings.focus : breakMinutes) * 60); }
  function reset() { setRunning(false); setCompletion(""); setSecondsLeft((mode === "focus" ? settings.focus : breakMinutes) * 60); }
  function updateSetting(name, value) { const updated = { ...settings, [name]: Number(value) }; setSettings(updated); if (name === "focus" && mode === "focus" && !running) setSecondsLeft(Number(value) * 60); }
  function startBreak() { setCompletion(""); setMode("break"); setSecondsLeft(breakMinutes * 60); }
  function repeatFocus() { setCompletion(""); setMode("focus"); setSecondsLeft(settings.focus * 60); }
  function finishForToday() { setCompletion(""); setMode("focus"); setSecondsLeft(settings.focus * 60); }
  function choosePreset(name, focus, short, long) {
    setPreset(name);
    setSettings({ ...settings, focus, short, long });
    setMode("focus");
    setCompletion("");
    if (!running) setSecondsLeft(focus * 60);
  }
  const progress = Math.max(0, Math.min(100, (1 - secondsLeft / Math.max(totalSeconds, 1)) * 100));
  const displayedCycle = cycles % settings.cycles || (cycles > 0 ? settings.cycles : 0);
  return <>
    <PageHeading eyebrow="CONCENTRACIÓN AMABLE" title="Pomodoro" subtitle="Concéntrate un rato, descansa un poco. Repite cuando estés listo." action={<button className="icon-button settings-trigger" onClick={() => setShowSettings(!showSettings)} aria-label="Ajustes">☷</button>} />
    <div className="pomodoro-layout"><section className="panel timer-panel"><div className="timer-tabs"><button className={mode === "focus" ? "selected" : ""} onClick={() => switchMode("focus")}>Enfoque</button><button className={mode === "break" ? "selected" : ""} onClick={() => switchMode("break")}>Descanso</button></div><div className="timer-presets"><span>Sesión rápida</span>{[["25 / 5", 25, 5, 15], ["50 / 10", 50, 10, 20], ["3 h / 30", 180, 30, 30]].map(([name, focus, short, long]) => <button key={name} className={preset === name ? "selected" : ""} disabled={running} onClick={() => choosePreset(name, focus, short, long)}>{name} min</button>)}</div>
      <div className="timer-content"><div className="timer-ring" style={{ "--progress": `${progress}%` }}><div className="timer-inner"><span>{mode === "focus" ? "TIEMPO DE ENFOQUE" : "TÓMATE UN RESPIRO"}</span><strong>{String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</strong><small>{mode === "focus" ? "Estás haciendo un buen trabajo ✦" : "Deja que tu mente descanse"}</small><button className="timer-play" onClick={() => { if (secondsLeft === 0) reset(); else setRunning(!running); }} aria-label={running ? "Pausar" : "Comenzar"}>{running ? "Ⅱ" : "▶"}</button></div></div><button className="timer-reset" onClick={reset}>↻ Reiniciar</button></div>
      {completion && <div className="timer-completion"><strong>{completion === "focus" ? "¡Buen trabajo! Tu sesión terminó." : "Descanso terminado."}</strong><p>{completion === "focus" ? `Has completado ${displayedCycle} de ${settings.cycles} sesiones.` : "¿Continuamos con una nueva sesión de enfoque?"}</p><div>{completion === "focus" ? <button className="button" onClick={startBreak}>{longBreak ? "Tomar descanso largo" : "Tomar descanso"}</button> : <button className="button" onClick={repeatFocus}>Repetir enfoque</button>}<button className="button button-secondary" onClick={finishForToday}>Terminar por hoy</button></div></div>}
      <div className="timer-progress"><div><strong>{displayedCycle}<small>/{settings.cycles}</small></strong><span>sesiones</span></div><div className="cycle-dots">{Array.from({ length: settings.cycles }, (_, index) => <i key={index} className={index < displayedCycle ? "done" : ""} />)}</div><div><strong>{Math.floor(cycles * settings.focus / 60)}<small>h</small> {cycles * settings.focus % 60}<small>m</small></strong><span>tiempo enfocado</span></div></div>
    </section><aside className="pomodoro-aside"><div className="focus-quote"><span>✦</span><h2>Presente en<br />este momento.</h2><p>No necesitas terminarlo todo. Solo empezar por algo.</p><small>UN RESPIRO A LA VEZ</small></div><div className="panel timer-tips"><span className="eyebrow">TU CICLO</span><div><i className="tip-dot focus" /><span>Enfoque</span><strong>{settings.focus} min</strong></div><div><i className="tip-dot break" /><span>Descanso corto</span><strong>{settings.short} min</strong></div><div><i className="tip-dot long" /><span>Descanso largo</span><strong>{settings.long} min</strong></div></div></aside></div>
    {showSettings && <div className="settings-popover panel"><div className="section-title"><h2>Duración de ciclos</h2><button className="delete-button" onClick={() => setShowSettings(false)}>×</button></div><label>Enfoque <input type="number" min="1" max="180" value={settings.focus} onChange={(event) => updateSetting("focus", event.target.value)} /></label><label>Descanso corto <input type="number" min="1" max="60" value={settings.short} onChange={(event) => updateSetting("short", event.target.value)} /></label><label>Descanso largo <input type="number" min="1" max="90" value={settings.long} onChange={(event) => updateSetting("long", event.target.value)} /></label><label>Sesiones antes del descanso largo <input type="number" min="2" max="8" value={settings.cycles} onChange={(event) => updateSetting("cycles", event.target.value)} /></label></div>}
  </>;
}
function StudyPage({ streak, setStreak, studiedToday, setStudiedToday, notify }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  async function loadFile(file) {
    if (!file) return;
    if (file.size > 2_000_000) { notify("El archivo supera el límite de 2 MB."); return; }
    if (!/\.(txt|md)$/i.test(file.name)) { notify("Por ahora puedes cargar archivos .txt o .md."); return; }
    setText(await file.text());
    setFileName(file.name);
    setResult(null);
  }
  function createStudySet() {
    const sentences = text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter((part) => part.length > 30);
    if (!text.trim()) { notify("Escribe o carga un texto para empezar."); return; }
    const summary = sentences.length ? sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.45))).join(" ") : text.trim().slice(0, 600);
    const cards = sentences.slice(0, 8).map((sentence, index) => ({ question: `Idea clave ${index + 1}`, answer: sentence }));
    setResult({ summary, cards });
    if (studiedToday !== dateKey(new Date())) {
      setStreak(streak + 1);
      setStudiedToday(dateKey(new Date()));
    }
    notify("¡Tu material de estudio está listo!");
  }
  const card = result?.cards[cardIndex];
  return <>
    <PageHeading eyebrow="APRENDER A TU MANERA" title="Estudio" subtitle="Convierte tus apuntes en ideas claras y tarjetas para repasar." action={<span className="streak-badge">✦ <strong>{streak}</strong> días de racha</span>} />
    <div className="study-layout"><section className="panel study-upload"><div className="study-intro"><span className="study-icon">✳</span><div><h2>Tu espacio de estudio</h2><p>Carga un archivo de texto o pega aquí tus apuntes. Tu contenido no sale de este dispositivo.</p></div></div>
      <label className="upload-zone"><input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => loadFile(event.target.files?.[0])} /><span className="upload-icon">↑</span><strong>{fileName || "Arrastra tu documento aquí"}</strong><small>o <u>explora tus archivos</u> · TXT o Markdown · hasta 2 MB</small></label>
      <div className="form-divider"><span>o pega tus apuntes</span></div><textarea className="study-textarea" placeholder="Pega aquí el texto que quieres resumir y estudiar..." value={text} onChange={(event) => { setText(event.target.value); setFileName(""); }} /><div className="study-actions"><span>{text.length.toLocaleString("es-MX")} caracteres</span><Button onClick={createStudySet}>✦ Crear resumen y tarjetas</Button></div><div className="study-privacy">✧ El procesamiento es local y el texto no se envía a ningún servidor.</div>
    </section><aside className="study-aside"><div className="study-streak"><span className="eyebrow">TU CONSTANCIA</span><div className="streak-number">{streak}<span>✦</span></div><strong>días aprendiendo</strong><p>Un poco cada día construye grandes conocimientos.</p><div className="streak-week">{["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <div key={`${day}-${index}`}><span>{day}</span><i className={index < Math.min(streak, 7) ? "completed" : ""}>{index < Math.min(streak, 7) ? "✓" : ""}</i></div>)}</div></div><div className="study-tip"><span>✧</span><p>Estudiar en sesiones cortas y frecuentes ayuda a recordar mejor.</p></div></aside></div>
    {result && <div className="study-results"><section className="panel summary-result"><SectionTitle title="Resumen sencillo" action={<span className="summary-tag">LECTURA RÁPIDA</span>} /><p>{result.summary}</p><span className="summary-footer">✦ Resumen generado localmente a partir de tu texto.</span></section><section className="flashcard-section"><div className="section-title"><div><span className="eyebrow">REPASO ACTIVO</span><h2>Tarjetas de estudio</h2></div><span className="card-counter">{result.cards.length ? cardIndex + 1 : 0} / {result.cards.length}</span></div>{card ? <button className={`flashcard ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)}><small>{flipped ? "RESPUESTA" : "PREGUNTA"} · TOCA PARA GIRAR</small><strong>{flipped ? card.answer : card.question}</strong><span>↻</span></button> : <div className="panel empty-cards">No se encontraron suficientes frases para crear tarjetas, pero ya tienes tu resumen.</div>}<div className="flashcard-controls"><button className="icon-button" onClick={() => { setFlipped(false); setCardIndex((cardIndex - 1 + result.cards.length) % result.cards.length); }} disabled={!result.cards.length}>←</button><span>Una idea a la vez</span><button className="icon-button" onClick={() => { setFlipped(false); setCardIndex((cardIndex + 1) % result.cards.length); }} disabled={!result.cards.length}>→</button></div></section></div>}
  </>;
}
function EntryModal({ type, onClose, onSave }) {
  const config = {
    task: { title: "Nueva tarea", description: "Anota eso que quieres sacar adelante.", submit: "Agregar tarea" },
    event: { title: "Nuevo evento", description: "Reserva un espacio para lo que importa.", submit: "Guardar evento" },
    routine: { title: "Nueva rutina", description: "Crea un hábito que te haga bien.", submit: "Guardar rutina" },
    transaction: { title: "Nuevo movimiento", description: "Registra tus ingresos o gastos.", submit: "Guardar movimiento" },
  }[type];
  const [form, setForm] = useState({
    title: "", category: type === "transaction" ? "Comida" : "Estudio", due: dateKey(new Date()), date: dateKey(new Date()),
    priority: "Media", color: COLORS[0], start: "09:00", end: "10:00", note: "", repeat: "Nunca",
    time: "08:00", days: [1, 2, 3, 4, 5], transactionType: "expense", amount: "",
  });
  const update = (key, value) => setForm({ ...form, [key]: value });
  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    if (type === "task") onSave({ title: form.title.trim(), category: form.category, due: form.due, priority: form.priority, color: form.color });
    if (type === "event") onSave({ title: form.title.trim(), date: form.date, start: form.start, end: form.end, note: form.note.trim(), repeat: form.repeat, color: form.color });
    if (type === "routine") onSave({ title: form.title.trim(), time: form.time, days: form.days, color: form.color });
    if (type === "transaction") onSave({ title: form.title.trim(), type: form.transactionType, category: form.category, amount: Number(form.amount), date: form.date });
  }
  const weekdays = ["L", "M", "M", "J", "V", "S", "D"];
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="entry-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><span className="eyebrow">TUNDRA</span><h2>{config.title}</h2><p>{config.description}</p>
    <label className="field-label">Nombre<input autoFocus required value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="¿Qué tienes en mente?" /></label>
    {type === "task" && <><div className="field-row"><label className="field-label">Categoría<select value={form.category} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Prioridad<select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option>Alta</option><option>Media</option><option>Baja</option></select></label></div><label className="field-label">Fecha<input type="date" value={form.due} onChange={(event) => update("due", event.target.value)} /></label></>}
    {type === "event" && <><div className="field-row"><label className="field-label">Fecha<input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></label><label className="field-label">Repetir<select value={form.repeat} onChange={(event) => update("repeat", event.target.value)}><option>Nunca</option><option>Diario</option><option>Semanal</option><option>Mensual</option></select></label></div><div className="field-row"><label className="field-label">Inicio<input type="time" value={form.start} onChange={(event) => update("start", event.target.value)} /></label><label className="field-label">Fin<input type="time" value={form.end} onChange={(event) => update("end", event.target.value)} /></label></div><label className="field-label">Nota (opcional)<input value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="Ej. Llevar materiales" /></label></>}
    {type === "routine" && <><label className="field-label">Hora<input type="time" value={form.time} onChange={(event) => update("time", event.target.value)} /></label><fieldset className="day-field"><legend>Repetir los días</legend><div>{weekdays.map((day, index) => <button type="button" key={index} className={form.days.includes(index) ? "selected" : ""} onClick={() => update("days", form.days.includes(index) ? form.days.filter((item) => item !== index) : [...form.days, index].sort())}>{day}</button>)}</div></fieldset></>}
    {type === "transaction" && <><div className="type-switch"><button type="button" className={form.transactionType === "expense" ? "selected" : ""} onClick={() => update("transactionType", "expense")}>Gasto</button><button type="button" className={form.transactionType === "income" ? "selected" : ""} onClick={() => update("transactionType", "income")}>Ingreso</button></div><div className="field-row"><label className="field-label">Monto (MXN)<input required type="number" min="1" step="0.01" value={form.amount} onChange={(event) => update("amount", event.target.value)} placeholder="0.00" /></label><label className="field-label">Categoría<select value={form.category} onChange={(event) => update("category", event.target.value)}>{["Comida", "Transporte", "Estudio", "Hogar", "Salud", "Ingresos", "Otro"].map((item) => <option key={item}>{item}</option>)}</select></label></div><label className="field-label">Fecha<input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></label></>}
    {type !== "transaction" && <fieldset className="color-field"><legend>Color de la categoría</legend><div>{COLORS.map((color) => <button type="button" key={color} aria-label="Seleccionar color" className={form.color === color ? "selected" : ""} style={{ background: color }} onClick={() => update("color", color)} />)}</div></fieldset>}
    <div className="modal-actions"><Button secondary className="cancel-button" onClick={onClose}>Cancelar</Button><button className="button" type="submit">{config.submit}</button></div>
  </form></div>;
}

export default App;
