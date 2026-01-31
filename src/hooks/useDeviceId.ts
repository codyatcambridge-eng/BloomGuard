import { useState, useEffect } from 'react';

const DEVICE_ID_KEY = 'iron_watch_device_id';

const generateDeviceId = (): string => {
  return 'device_' + crypto.randomUUID();
};

export const useDeviceId = () => {
  const [deviceId, setDeviceId] = useState<string>('');

  useEffect(() => {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateDeviceId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    setDeviceId(id);
  }, []);

  return deviceId;
};
