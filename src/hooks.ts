import {
  Dispatch,
  useEffect,
  useState,
  SetStateAction,
  useCallback,
  useRef,
} from 'react';
import { deepEqual } from './deepEqual';
import {
  getBrowserStorageValue,
  setBrowserStorageValue,
  Store,
} from './storage';

export function useBrowserStorageState<K extends keyof Store>(
  key: K,
  initialValue: Store[K]
): [Store[K], Dispatch<SetStateAction<Store[K]>>, boolean] {
  const [state, setState] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(true);
  const editRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const readRevision = editRevision.current;
    async function getBrowserStorageState() {
      setIsLoading(true);
      const value = await getBrowserStorageValue(key);

      if (
        !cancelled &&
        readRevision === editRevision.current &&
        value !== undefined
      ) {
        setState((prevState) =>
          cancelled ||
          readRevision !== editRevision.current ||
          deepEqual(prevState, value)
            ? prevState
            : value
        );
      }
    }

    getBrowserStorageState()
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setBrowserStorageState = useCallback(
    (value: SetStateAction<Store[K]>) => {
      editRevision.current++;
      setState((prevState) => {
        const newValue = value instanceof Function ? value(prevState) : value;
        setBrowserStorageValue(key, newValue);
        return newValue;
      });
    },
    [key]
  );

  return [state, setBrowserStorageState, isLoading];
}
