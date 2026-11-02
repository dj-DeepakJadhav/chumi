// Optional local configuration. Existing process environment takes precedence.
try { process.loadEnvFile(); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not load the local .env configuration.'); }
