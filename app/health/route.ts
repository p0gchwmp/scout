// Compatibility health path for local/hosting supervisors. Re-export the
// canonical owner-authenticated readiness handler so /health never becomes a
// weaker public probe than /api/health.
export { GET } from "../api/health/route";
