export interface ProtectionModeInput {
  effectiveShieldEnabled: boolean;
  blurDial: number;
  flashShieldEnabled: boolean;
}

export function isProtectionOffState(input: ProtectionModeInput): boolean {
  return !input.effectiveShieldEnabled || (input.blurDial === 0 && input.flashShieldEnabled !== true);
}

export function shouldRunRuntimeModeration(input: ProtectionModeInput): boolean {
  return input.effectiveShieldEnabled && input.blurDial > 0;
}

export function shouldRunFlashShield(input: ProtectionModeInput): boolean {
  return input.effectiveShieldEnabled && input.flashShieldEnabled === true;
}

export function shouldInjectForProtection(input: ProtectionModeInput): boolean {
  return shouldRunRuntimeModeration(input) || shouldRunFlashShield(input);
}
