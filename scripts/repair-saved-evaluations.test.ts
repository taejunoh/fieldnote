import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { formatRepairCliError, SafeRepairCliError } from './repair-saved-evaluations';

describe('saved evaluation repair CLI error reporting', () => {
  it('sends typed RPC failure details through the safe formatter', async () => {
    const source = await readFile(new URL('./repair-saved-evaluations.ts', import.meta.url), 'utf8');
    expect(source).toContain('class SafeRepairCliError');
    expect(source).toContain('formatRepairCliError(error)');
    expect(source).not.toContain('main().catch(()=>{console.error("Saved evaluation repair stopped; inspect private inputs and database guards. No retry or provider call was made.")');
  });
  it('reports RPC stage and SQLSTATE without leaking message, details, or credential text', () => {
    const failure = Object.assign(new Error('private payload'), {
      code: 'P0001', details: 'rejected report JSON', hint: 'SUPABASE_SERVICE_ROLE_KEY=secret',
    });
    const output = formatRepairCliError(new SafeRepairCliError(failure));
    expect(output).toContain('rpc_apply');
    expect(output).toContain('SQLSTATE P0001');
    expect(output).not.toContain('private payload');
    expect(output).not.toContain('rejected report JSON');
    expect(output).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
  it('reports the RPC stage without displaying malformed SQLSTATE values', () => {
    const output = formatRepairCliError(new SafeRepairCliError({ code: 'key=secret' }));
    expect(output).toContain('rpc_apply');
    expect(output).not.toContain('key=secret');
    expect(output).not.toContain('SQLSTATE');
  });
});
