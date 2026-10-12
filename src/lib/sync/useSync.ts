import { useEffect, useState } from 'react';
import { downloadProgress, getStatus, onDownloadProgress, subscribe } from './engine';

export function useSyncStatus() {
  const [status, setStatus] = useState(getStatus);
  useEffect(() => subscribe(setStatus), []);
  return status;
}

/** How far along this document's download is (0 to 1), or null if none is running. */
export function useDownloadProgress(id: string | null) {
  const read = () => (id === null ? null : downloadProgress().get(id) ?? null);
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    return onDownloadProgress(() => setValue(read()));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}
