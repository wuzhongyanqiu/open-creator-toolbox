const baseUrl = process.env.VOICESTUDIO_URL ?? 'http://127.0.0.1:3900';

try {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  console.log(`VoiceStudio ready at ${baseUrl}`);
  console.log(await response.text());
} catch (error) {
  console.error(`VoiceStudio is not available at ${baseUrl}. Start the desktop app, then retry.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
