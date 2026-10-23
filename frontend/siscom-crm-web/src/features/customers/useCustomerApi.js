import React from 'react';

const NO_STATE = null;
const noopSubscribe = () => () => {};
// Subscribes a component to a customerApi controller (or to nothing when the flag is OFF and `ctrl` is null). Returns controller state or null.
export function useCustomerApiState(ctrl) {
  const getState = ctrl ? ctrl.getState : () => NO_STATE;
  return React.useSyncExternalStore(ctrl ? ctrl.subscribe : noopSubscribe, getState, getState);
}
