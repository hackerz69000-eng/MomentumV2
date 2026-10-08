// Local authentication system using localStorage
// Stores username & password without external providers or APIs.

export interface LocalUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface ActiveUser {
  id: string;
  username: string;
  email: string;
}

const USERS_KEY = "momentum_local_users";
const ACTIVE_USER_KEY = "momentum_active_user";
const AUTH_EVENT_NAME = "momentum_auth_state_changed";

// Simple reproducible hash for password storage in localStorage
function hashPassword(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return "h_" + Math.abs(hash).toString(36) + "_" + password.length;
}

export function getLocalUsers(): LocalUser[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users: LocalUser[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getActiveUser(): ActiveUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveUser;
  } catch {
    return null;
  }
}

export function setActiveUser(user: ActiveUser | null) {
  if (typeof window === "undefined") return;
  if (user) {
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(ACTIVE_USER_KEY);
  }
  window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME, { detail: user }));
}

export function signUpLocal(username: string, password: string): { user: ActiveUser } {
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }

  const users = getLocalUsers();
  const existing = users.find((u) => u.username.toLowerCase() === cleanUsername);
  if (existing) {
    throw new Error("An account with that username already exists. Please sign in instead.");
  }

  const id = "usr_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
  const newUser: LocalUser = {
    id,
    username: cleanUsername,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveLocalUsers(users);

  const active: ActiveUser = {
    id,
    username: cleanUsername,
    email: `${cleanUsername}@local.momentum`,
  };
  setActiveUser(active);
  return { user: active };
}

export function signInLocal(username: string, password: string): { user: ActiveUser } {
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername) throw new Error("Please enter your username.");
  if (!password) throw new Error("Please enter your password.");

  const users = getLocalUsers();
  const found = users.find((u) => u.username.toLowerCase() === cleanUsername);

  if (!found) {
    throw new Error("No account found with this username. Please check your username or sign up.");
  }

  if (found.passwordHash !== hashPassword(password)) {
    throw new Error("Incorrect password. Please try again.");
  }

  const active: ActiveUser = {
    id: found.id,
    username: found.username,
    email: `${found.username}@local.momentum`,
  };
  setActiveUser(active);
  return { user: active };
}

export function signOutLocal() {
  setActiveUser(null);
}

export function onLocalAuthStateChange(callback: (user: ActiveUser | null) => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ActiveUser | null>).detail;
    callback(detail ?? null);
  };
  window.addEventListener(AUTH_EVENT_NAME, handler);
  return () => window.removeEventListener(AUTH_EVENT_NAME, handler);
}
