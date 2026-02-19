export interface ScreenTimeStatus {
  supported: boolean;
  authorized: boolean;
  reason?: string;
}

export interface ScreenTimePickerOptions {
  shieldId: string;
  blob: string | null;
}

export interface ScreenTimePickerResult {
  blob: string;
  selectedCount?: number;
  label?: string;
}

export interface ApplyShieldRestrictionsRequest {
  shieldId: string;
  selectionBlob: string;
  windows: unknown[];
  reason: string;
  timestamp: string;
  strictness?: number;
}

export interface ScreenTimePlugin {
  getScreenTimeStatus(): Promise<ScreenTimeStatus>;
  requestScreenTimeAuthorization(): Promise<ScreenTimeStatus>;
  presentFamilyActivityPicker(options: ScreenTimePickerOptions): Promise<ScreenTimePickerResult>;
  applyShieldRestrictions(options: ApplyShieldRestrictionsRequest): Promise<{ success: boolean }>;
  clearShieldRestrictions(options: { reason: string }): Promise<{ success: boolean }>;
}

export interface ScreenTimeSelectionInfo {
  label: string;
  selectedCount: number;
}
