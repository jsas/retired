import { describe, it, expect } from 'vitest';
import { buildPlanCode, parsePlanCode } from './planTransfer';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';

// A minimal but realistic inputs object — parse only checks `currentAge` is a
// number, so the rest just needs to survive the round trip intact.
const sampleInputs = {
  currentAge: 55,
  retirementAge: 60,
  maxAge: 95,
  rrspBalance: 600000,
  desiredSpending: 52000,
  provinceCode: 'BC',
} as unknown as RetirementInputs;

describe('buildPlanCode → parsePlanCode round trip', () => {
  it('round-trips inputs intact', () => {
    const code = buildPlanCode(sampleInputs, 'Retire at 60');
    const decoded = parsePlanCode(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.inputs.currentAge).toBe(55);
    expect(decoded!.inputs.rrspBalance).toBe(600000);
    expect(decoded!.inputs.provinceCode).toBe('BC');
  });

  it('carries the plan name', () => {
    const decoded = parsePlanCode(buildPlanCode(sampleInputs, 'My plan'))!;
    expect(decoded.name).toBe('My plan');
  });

  it('omits the name when not given', () => {
    const decoded = parsePlanCode(buildPlanCode(sampleInputs))!;
    expect(decoded.name).toBeUndefined();
  });

  it('produces URL-safe base64 (no +, /, or =)', () => {
    const code = buildPlanCode(sampleInputs, 'x');
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('parsePlanCode legacy + defensive decoding', () => {
  it('accepts a legacy bare-inputs object (old share links)', () => {
    // Legacy links are base64url of the inputs object directly (no envelope).
    const legacy = btoa(JSON.stringify(sampleInputs)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const decoded = parsePlanCode(legacy)!;
    expect(decoded.inputs.currentAge).toBe(55);
    expect(decoded.name).toBeUndefined();
  });

  it('accepts raw JSON text of an envelope', () => {
    const json = JSON.stringify({ tool: 're-tired-plan', version: 1, name: 'Raw', inputs: sampleInputs });
    const decoded = parsePlanCode(json)!;
    expect(decoded.name).toBe('Raw');
    expect(decoded.inputs.currentAge).toBe(55);
  });

  it('accepts raw JSON text of bare inputs', () => {
    const decoded = parsePlanCode(JSON.stringify(sampleInputs))!;
    expect(decoded.inputs.currentAge).toBe(55);
  });

  it('migrates older inputs on the way in', () => {
    // annualContribution is a v1 field that migrateInputs splits per account.
    const old = { ...sampleInputs, annualContribution: 6000 };
    const decoded = parsePlanCode(buildPlanCode(old as RetirementInputs))!;
    expect(decoded.inputs.tfsaContribution).toBe(6000);
    expect((decoded.inputs as unknown as Record<string, unknown>).annualContribution).toBeUndefined();
  });

  it('returns null for garbage', () => {
    expect(parsePlanCode('')).toBeNull();
    expect(parsePlanCode('   ')).toBeNull();
    expect(parsePlanCode('not-a-plan!!!')).toBeNull();
    expect(parsePlanCode(btoa('{"foo":1}'))).toBeNull(); // valid b64, wrong shape
  });
});
