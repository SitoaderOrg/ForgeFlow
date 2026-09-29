/**
 * Simple service health check
 */
export function getHealthStatus() {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };
}
