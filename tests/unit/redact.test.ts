import { describe, it, expect } from 'vitest';
import { redact } from '../../src/redact.js';

describe('redact', () => {
  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redact(`token=${jwt}`)).toContain('[REDACTED_JWT]');
    expect(redact(`token=${jwt}`)).not.toContain('eyJhbGci');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig';
    const result = redact(input);
    expect(result).toContain('[REDACTED_BEARER]');
    expect(result).not.toContain('eyJhbGci');
  });

  it('redacts Authorization headers', () => {
    const input = 'Authorization: Basic dXNlcjpwYXNz';
    const result = redact(input);
    expect(result).toContain('[REDACTED_AUTH]');
  });

  it('redacts email addresses', () => {
    const input = 'user email: john.doe@example.com sent request';
    const result = redact(input);
    expect(result).toContain('[REDACTED_EMAIL]');
    expect(result).not.toContain('john.doe@example.com');
  });

  it('redacts AWS access keys', () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE';
    const result = redact(input);
    expect(result).toContain('[REDACTED_AWS_KEY]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts password fields', () => {
    expect(redact('password=secret123')).toContain('[REDACTED_SECRET]');
    expect(redact('passwd: mypasswd')).toContain('[REDACTED_SECRET]');
    expect(redact('secret=abc123def')).toContain('[REDACTED_SECRET]');
    expect(redact('api_key=xyz789')).toContain('[REDACTED_SECRET]');
  });

  it('passes through non-sensitive content unchanged', () => {
    const input = '2024-01-15 10:30:00 INFO Request processed successfully status=200 duration=45ms';
    expect(redact(input)).toBe(input);
  });

  it('handles multiple sensitive items in one string', () => {
    const input = 'user john@example.com with password=secret123';
    const result = redact(input);
    expect(result).toContain('[REDACTED_EMAIL]');
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('john@example.com');
    expect(result).not.toContain('secret123');
  });

  it('handles empty string', () => {
    expect(redact('')).toBe('');
  });
});
