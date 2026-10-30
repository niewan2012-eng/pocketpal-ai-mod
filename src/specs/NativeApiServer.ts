import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Transport for the LAN API server: HTTP in, HTTP out, nothing else.
 *
 * Incoming requests arrive as `ApiServerRequest` device events. Each carries an
 * `id` that must be answered exactly once, either with `respond` (whole body) or
 * with `beginStream` / `writeStreamChunk` / `endStream` (SSE).
 */
export interface ApiServerInfo {
  running: boolean;
  port: number;
  urls: string[];
}

export interface ApiServerRequestEvent {
  id: number;
  method: string;
  path: string;
  body: string;
}

export interface Spec extends TurboModule {
  start(port: number): Promise<ApiServerInfo>;
  stop(): Promise<void>;
  getInfo(): Promise<ApiServerInfo>;
  respond(id: number, status: number, contentType: string, body: string): void;
  beginStream(id: number, status: number, contentType: string): boolean;
  writeStreamChunk(id: number, chunk: string): void;
  endStream(id: number): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('ApiServerModule');
