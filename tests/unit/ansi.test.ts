import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../../src/formatters/ansi.js';

describe('stripAnsi', () => {
  it('removes basic color codes', () => {
    expect(stripAnsi('\x1b[31mred text\x1b[0m')).toBe('red text');
  });

  it('removes bold/underline codes', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[22m \x1b[4munderline\x1b[24m')).toBe('bold underline');
  });

  it('removes 256-color codes', () => {
    expect(stripAnsi('\x1b[38;5;196mred\x1b[0m')).toBe('red');
  });

  it('removes RGB color codes', () => {
    expect(stripAnsi('\x1b[38;2;255;0;0mred\x1b[0m')).toBe('red');
  });

  it('removes cursor movement sequences', () => {
    expect(stripAnsi('\x1b[2Amoved up')).toBe('moved up');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('handles multiple sequences in one line', () => {
    expect(stripAnsi('\x1b[32mGET\x1b[0m /api \x1b[33m200\x1b[0m')).toBe('GET /api 200');
  });
});
