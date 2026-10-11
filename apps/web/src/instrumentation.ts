// Executado uma vez quando o servidor sobe.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./server/env');
    validateEnv();
  }
}
