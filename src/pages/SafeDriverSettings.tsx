import { Shield } from 'lucide-react';
import { SafeDriverCard } from '@/components/safeDriver/SafeDriverCard';
import { SafeDriverPermissionAuditor } from '@/components/safeDriver/SafeDriverPermissionAuditor';
import { SafeDriverGarage } from '@/components/safeDriver/SafeDriverGarage';
import { useSafeDriverMode } from '@/hooks/useSafeDriverMode';
import { useSafeDriverHealthCheck } from '@/hooks/useSafeDriverHealthCheck';
import { SafeDriver } from '@/plugins/SafeDriver';
import { toast } from 'sonner';

const SafeDriverSettings = () => {
  const safeDriver = useSafeDriverMode();
  const healthCheck = useSafeDriverHealthCheck();

  const handleFixPermissions = () => {
    const screenStatus = healthCheck.permissionSnapshot?.screenTime.status;
    void (async () => {
      if (screenStatus === 'notDetermined') {
        await SafeDriver.requestScreenTimeAuth().catch(() => {
          toast('Screen Time auth request failed.');
        });
      }
      SafeDriver.openSettings()
        .then((result) => {
          if (!result.opened) {
            toast('Unable to open Settings. Adjust permissions manually.');
          }
        })
        .catch(() => {
          toast('Unable to open Settings. Adjust permissions manually.');
        })
        .finally(() => {
          healthCheck.refresh();
        });
    })();
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-4 pt-8 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-gold" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">SAFE DRIVER HUB</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              Garage control, permissions, and diagnostics
            </p>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        <SafeDriverCard
          mode={safeDriver.state.mode}
          countdownRemainingMs={safeDriver.countdownRemainingMs}
          screenTimeMessage={safeDriver.screenTimeUnavailableMessage}
          onStart={safeDriver.startCountdown}
          onCancel={safeDriver.cancel}
          onOpenMusic={safeDriver.openMusic}
          onSendCheckin={safeDriver.sendCheckinText}
          onRememberCar={safeDriver.rememberCar}
          onDismissCar={safeDriver.dismissCarPrompt}
          carName={safeDriver.carName}
          hasUnapprovedCar={safeDriver.hasUnapprovedCar}
          showCheckinCopy={safeDriver.shouldShowCheckinCopy}
          safeDriverEnabled={safeDriver.safeDriverEnabled}
          autoStartOnApprovedCar={safeDriver.autoStartOnApprovedCar}
          onToggleSafeDriver={safeDriver.toggleSafeDriver}
          onToggleAutoStart={safeDriver.toggleAutoStart}
          bluetoothIdentifiersText={safeDriver.bluetoothIdentifiersText}
          bluetoothServiceUUIDsText={safeDriver.bluetoothServiceUUIDsText}
          bluetoothRssiThreshold={safeDriver.bluetoothRssiThreshold}
          onUpdateBluetoothIdentifiers={safeDriver.updateBluetoothIdentifiers}
          onUpdateBluetoothServiceUUIDs={safeDriver.updateBluetoothServiceUUIDs}
          onUpdateBluetoothRssiThreshold={safeDriver.updateBluetoothRssiThreshold}
          onRegisterAccessory={safeDriver.registerAccessory}
          registeringAccessory={safeDriver.registeringAccessory}
          showSettingsControls
        />

        <SafeDriverPermissionAuditor
          screenTimeStatus={safeDriver.screenTimeStatus}
          permissionSnapshot={healthCheck.permissionSnapshot}
          liveActivityStatus={healthCheck.liveActivityStatus}
          loading={healthCheck.loading}
          onFix={handleFixPermissions}
          onRefresh={healthCheck.refresh}
        />

        <SafeDriverGarage
          pairedCars={safeDriver.pairedCars}
          rssiThreshold={safeDriver.bluetoothRssiThreshold}
          onAddVehicle={safeDriver.showAccessoryPicker}
          onUpdateRssiThreshold={safeDriver.updateBluetoothRssiThreshold}
          onTestConnection={safeDriver.testConnection}
        />
      </main>
    </div>
  );
};

export default SafeDriverSettings;
