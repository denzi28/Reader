import { useEffect, useState } from 'react';
import { getStatus, subscribe } from './engine';

export function useSyncStatus() {
  const [status, setStatus] = useState(getStatus);
  useEffect(() => subscribe(setStatus), []);
  return status;
}
