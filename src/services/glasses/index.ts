/**
 * Glasses module — unified API for Ray-Ban Meta Smart Glasses
 * 
 * Usage:
 *   import { connectionManager } from '../services/glasses';
 *   
 *   await connectionManager.initialize();
 *   await connectionManager.setMode('auto'); // 'ble' | 'sdk' | 'auto'
 *   await connectionManager.scanAndConnect();
 *   await connectionManager.sendText('Hello from Jarvis');
 */

export { connectionManager, ConnectionManager } from './ConnectionManager';
export type { ConnectionStatus } from './ConnectionManager';

export { BLEProvider } from './BLEProvider';
export { MetaSDKProvider } from './MetaSDKProvider';

export type {
  IGlassesProvider,
  ProviderCapabilities,
  ConnectionMode,
  ConnectionState,
  GlassesInfo,
  MediaAsset,
  DisplayCard,
  GestureEvent,
  LEDState,
  GlassesEventHandlers,
} from './GlassesProvider';

export { UnsupportedCapabilityError } from './GlassesProvider';
