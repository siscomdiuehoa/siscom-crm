// API mode permission gate (UI only — NOT security; the backend permission guards remain the only enforcement).
// There is no authenticated server actor and no server-provided permission set in the frontend yet, so every action is denied (fail-closed).
// Never derive anything from the demo role matrix (src/auth/permissions.js), the demo user switch or localStorage.
// A future server-granted actor must be passed in explicitly as `grants` (set of action names); until then callers get `() => false`.
export function createApiModeCan(grants) {
  const allowed = grants instanceof Set ? grants : null;
  return (action) => !!allowed && allowed.has(action);
}
