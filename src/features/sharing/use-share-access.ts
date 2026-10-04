import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import { requireApiAccess } from '../connection/state';
import { requestApiAccess } from '../page-context/actions';

export function useShareAccess(origin: string | undefined) {
  const [state, setState] = useState<'checking' | 'granted' | 'needed'>(() =>
    isExtension() ? 'checking' : 'granted',
  );
  useEffect(() => {
    if (!isExtension() || !origin) return;
    let live = true;
    const check = () => {
      void requireApiAccess(origin)
        .then(() => {
          if (live) setState('granted');
        })
        .catch(() => {
          if (live) setState('needed');
        });
    };
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      live = false;
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  }, [origin]);
  const request = async () => {
    if (!origin) throw new Error('此部署尚未配置分享数据服务。');
    // Invoke permission.request before yielding the click's user activation.
    await requestApiAccess(origin);
    await requireApiAccess(origin);
    setState('granted');
  };
  return { state, request };
}
