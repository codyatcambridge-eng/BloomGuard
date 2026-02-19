import type {
  ApplyShieldRestrictionsRequest,
  ScreenTimePickerOptions,
  ScreenTimePickerResult,
  ScreenTimeStatus,
  ScreenTimePlugin,
} from '@/native/screenTimeTypes';

const unsupportedStatus: ScreenTimeStatus = {
  supported: false,
  authorized: false,
  reason: 'unsupported_platform',
};

const unsupportedError = new Error('Screen Time is unsupported on this platform');

export class ScreenTimeWeb implements ScreenTimePlugin {
  async getScreenTimeStatus(): Promise<ScreenTimeStatus> {
    return unsupportedStatus;
  }

  async requestScreenTimeAuthorization(): Promise<ScreenTimeStatus> {
    return unsupportedStatus;
  }

  async presentFamilyActivityPicker(_options: ScreenTimePickerOptions): Promise<ScreenTimePickerResult> {
    return Promise.reject(unsupportedError);
  }

  async applyShieldRestrictions(_options: ApplyShieldRestrictionsRequest): Promise<{ success: boolean }> {
    return Promise.reject(unsupportedError);
  }

  async clearShieldRestrictions(): Promise<{ success: boolean }> {
    return Promise.reject(unsupportedError);
  }
}
