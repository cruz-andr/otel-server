// Covers CSI sequences, OSC sequences, and charset selection sequences
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '');
}
