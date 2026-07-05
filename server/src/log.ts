// Lightweight stdout logging for local debugging. Off unless REVUE_DEBUG is
// set (npm run dev sets it); pipeline errors always print regardless so a
// failed run is never silent.

export const debugEnabled = process.env['REVUE_DEBUG'] === '1';

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export function dlog(scope: string, message: string): void {
  if (debugEnabled) console.log(`${stamp()} [${scope}] ${message}`);
}

export function elog(scope: string, message: string): void {
  console.error(`${stamp()} [${scope}] ${message}`);
}
