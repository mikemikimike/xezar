/**
 * Is a listen error "this port cannot be had, try the next one" (#963)?
 *
 * Linux and macOS: only EADDRINUSE, exactly as before. EACCES there means a privileged port, which
 * the next port will not cure, so it stays a failure. Windows also answers EACCES for a port inside
 * a range the system has reserved for itself (Hyper-V, WSL, Docker – `netsh interface ipv4 show
 * excludedportrange protocol=tcp`), and those ranges move on every restart: such a port is as
 * unusable as a taken one, and the next port may well be free.
 *
 * Leaf layer: this folder imports only `node:*` and its own siblings.
 */
export function portTaken(code: string | undefined, platform: NodeJS.Platform = process.platform): boolean {
  return code === 'EADDRINUSE' || (platform === 'win32' && code === 'EACCES');
}
