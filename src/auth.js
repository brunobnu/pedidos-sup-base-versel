export const UserRole = {
  ADMIN: "administrador",
  VIEWER: "visualizador",
};

export const USERS = [
  { id: "admin", email: "admin@empresa.com", password: "admin123", role: UserRole.ADMIN, name: "Administrador" },
  { id: "viewer", email: "usuario@empresa.com", password: "usuario123", role: UserRole.VIEWER, name: "Visualizador" },
];

const SESSION_KEY = "order-history-session-v1";

const PERMISSIONS = {
  import: [UserRole.ADMIN],
  createClient: [UserRole.ADMIN],
  editClient: [UserRole.ADMIN],
  deleteClient: [UserRole.ADMIN],
  editMonthlyData: [UserRole.ADMIN],
  editSettings: [UserRole.ADMIN],
  editComments: [UserRole.ADMIN],
  generateAiInsights: [UserRole.ADMIN],
  deleteAiInsights: [UserRole.ADMIN],
  exportData: [UserRole.ADMIN, UserRole.VIEWER],
  view: [UserRole.ADMIN, UserRole.VIEWER],
};

export const authStore = {
  getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  },
  login(email, password) {
    const user = USERS.find((item) => item.email.toLowerCase() === String(email).toLowerCase().trim() && item.password === password);
    if (!user) return null;
    const session = { id: user.id, email: user.email, role: user.role, name: user.name, loggedAt: new Date().toISOString() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },
  logout() {
    localStorage.removeItem(SESSION_KEY);
  },
};

export function hasPermission(user, permission) {
  if (!user) return false;
  return (PERMISSIONS[permission] || []).includes(user.role);
}

export function ProtectedRoute(user, content, fallback) {
  return user ? content : fallback;
}

export function RequirePermission(user, permission, content = "", fallback = "") {
  return hasPermission(user, permission) ? content : fallback;
}
